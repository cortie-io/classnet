리눅스가 서버 운영체제로 사랑받는 가장 큰 이유는 네트워크 기능과 서버 프로그램이 풍부하기 때문이에요. 이 단원에서는 IP 주소와 경로를 확인·설정하는 명령과 설정 파일, 연결을 점검하는 도구, 방화벽(firewalld·iptables)을 먼저 익히고, 웹·파일 공유·FTP·DNS·SSH·DHCP 서버를 어떤 패키지와 설정 파일로 운영하는지 정리해요. 시험에서는 "이 서비스의 설정 파일은?", "이 데몬의 이름은?"처럼 짝짓기 문제가 많으니 표를 중심으로 익혀 두세요.

> [!GOAL]
> - `ip`·`nmcli`와 옛 명령 `ifconfig`·`route`로 네트워크 상태를 확인하고 설정할 수 있다.
> - `/etc/hosts`, `/etc/resolv.conf` 등 네트워크 설정 파일의 역할을 구분할 수 있다.
> - `ping`·`traceroute`·`ss`·`dig`로 연결을 점검하고, firewalld와 iptables 규칙을 읽고 쓸 수 있다.
> - Apache·Samba·NFS·vsftpd·BIND·sshd·DHCP 서버의 패키지, 서비스, 설정 파일, 포트를 짝지을 수 있다.

## 네트워크 인터페이스 확인과 설정

### 인터페이스 이름

리눅스는 랜 카드 같은 네트워크 장치를 **인터페이스**(Interface)라는 이름으로 다뤄요.

| 이름 | 뜻 |
|---|---|
| `lo` | 루프백(Loopback). 자기 자신을 가리키는 가상 인터페이스, 주소 127.0.0.1 |
| `eth0`, `eth1` | 전통적인 유선 이더넷 이름 |
| `ens33`, `enp0s3`, `eno1` | 요즘 배포판의 이름. 장치가 꽂힌 위치를 바탕으로 정해져 재부팅해도 이름이 바뀌지 않아요 |
| `wlan0`, `wlp2s0` | 무선 랜 |

### ip 명령 (현재 표준)

`ip` 명령 하나로 주소, 링크, 라우팅, ARP를 모두 다뤄요.

```bash
ip addr show                              # 모든 인터페이스의 주소 (줄여서 ip a)
ip addr add 192.168.10.20/24 dev ens33    # 주소 추가
ip addr del 192.168.10.20/24 dev ens33    # 주소 삭제
ip link set ens33 up                      # 인터페이스 켜기 (down은 끄기)
ip route show                             # 라우팅 테이블 (ip r)
ip route add default via 192.168.10.1     # 기본 게이트웨이 설정
ip route add 10.20.0.0/16 via 192.168.10.254   # 특정 네트워크로 가는 경로
ip neigh show                             # ARP 캐시(이웃 테이블)
```

```text
$ ip addr show ens33
2: ens33: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP
    link/ether 52:54:00:12:34:56 brd ff:ff:ff:ff:ff:ff
    inet 192.168.10.20/24 brd 192.168.10.255 scope global ens33
    inet6 fe80::5054:ff:fe12:3456/64 scope link
```

`link/ether`는 MAC 주소, `inet`은 IPv4 주소와 프리픽스, `brd`는 브로드캐스트 주소, `inet6`는 IPv6 주소예요.

### 옛 명령: ifconfig, route

`ifconfig`, `route`, `arp`, `netstat`은 net-tools라는 오래된 패키지의 명령이에요. 최신 배포판에는 기본으로 설치되지 않을 수 있지만, 시험에는 여전히 자주 나와요.

```bash
ifconfig                                              # 인터페이스 정보 보기
ifconfig ens33 192.168.10.20 netmask 255.255.255.0 up # 주소 설정
ifconfig ens33 down                                   # 인터페이스 끄기
route -n                                              # 라우팅 테이블 (숫자로)
route add default gw 192.168.10.1                     # 기본 게이트웨이
```

| 하는 일 | 옛 명령(net-tools) | 새 명령(iproute2) |
|---|---|---|
| 주소·인터페이스 보기 | `ifconfig` | `ip addr`, `ip link` |
| 라우팅 테이블 | `route -n`, `netstat -r` | `ip route` |
| ARP 테이블 | `arp -n` | `ip neigh` |
| 연결·포트 상태 | `netstat` | `ss` |

> [!WARNING]
> `ip`나 `ifconfig`로 바꾼 주소와 경로는 **재부팅하거나 네트워크를 다시 시작하면 사라지는 임시 설정**이에요. 계속 유지하려면 `nmcli`로 저장하거나 설정 파일에 적어야 해요.

### 호스트 이름

```bash
hostname                                  # 현재 호스트 이름
hostnamectl                               # 호스트 이름과 OS 정보
hostnamectl set-hostname web01.example.com   # 영구 변경 (/etc/hostname에 기록)
```

### nmcli — NetworkManager로 영구 설정

레드햇 계열(RHEL 7 이후)은 **NetworkManager** 서비스가 네트워크를 관리하고, 명령줄 도구 `nmcli`나 메뉴 방식의 `nmtui`로 설정해요. nmcli로 바꾼 설정은 저장되어 재부팅 후에도 유지돼요.

```bash
nmcli device status                       # 장치별 연결 상태
nmcli connection show                     # 저장된 연결(프로필) 목록
nmcli connection modify ens33 ipv4.method manual \
  ipv4.addresses 192.168.10.20/24 ipv4.gateway 192.168.10.1 \
  ipv4.dns 192.168.10.53                  # 고정 IP 설정
nmcli connection up ens33                 # 바뀐 설정 적용
```

연결(프로필) 이름은 장치 이름과 다를 수 있으니 `nmcli connection show`로 먼저 확인해요. 자동으로 주소를 받으려면 `ipv4.method auto`로 바꿔요.

## 네트워크 설정 파일

| 파일 | 역할 |
|---|---|
| `/etc/hosts` | 호스트 이름과 IP 주소를 직접 짝지어 둔 목록. 보통 DNS보다 먼저 확인해요 |
| `/etc/resolv.conf` | 사용할 **DNS 서버 주소**(`nameserver`)와 기본 검색 도메인(`search`) |
| `/etc/hostname` | 이 컴퓨터의 호스트 이름 |
| `/etc/nsswitch.conf` | 이름을 찾는 순서. `hosts: files dns`면 hosts 파일 → DNS 순서 |
| `/etc/services` | 서비스 이름과 포트 번호 목록(예: `ssh 22/tcp`) |
| `/etc/sysconfig/network-scripts/ifcfg-ens33` | 예전 레드햇 계열(CentOS 6·7 등)의 인터페이스 설정 파일 |
| `/etc/NetworkManager/system-connections/` | 최신 레드햇 계열(RHEL 9 등)에서 NetworkManager가 연결 설정을 저장하는 곳 |
| `/etc/network/interfaces` | 예전 데비안·우분투의 인터페이스 설정 파일 |
| `/etc/netplan/*.yaml` | 최근 우분투의 네트워크 설정(수정 후 `netplan apply`) |

```text
# /etc/hosts
127.0.0.1       localhost
192.168.10.20   web01.example.com   web01

# /etc/resolv.conf
nameserver 192.168.10.53
search example.com
```

예전 레드햇 계열의 인터페이스 설정 파일은 이렇게 생겼어요. 지금도 시험에 자주 나와요.

```text
# /etc/sysconfig/network-scripts/ifcfg-ens33
TYPE=Ethernet
DEVICE=ens33
BOOTPROTO=static
ONBOOT=yes
IPADDR=192.168.10.20
PREFIX=24
GATEWAY=192.168.10.1
DNS1=192.168.10.53
```

| 항목 | 뜻 |
|---|---|
| `BOOTPROTO` | 주소를 얻는 방법. `static`(또는 `none`)은 고정 IP, `dhcp`는 자동으로 받기 |
| `ONBOOT` | `yes`면 부팅할 때 이 인터페이스를 켜요 |
| `IPADDR` / `PREFIX` | IP 주소 / 프리픽스 길이. `PREFIX=24` 대신 `NETMASK=255.255.255.0`으로도 써요 |
| `GATEWAY` / `DNS1` | 기본 게이트웨이 / 첫 번째 DNS 서버 |

> [!EXAM]
> "DNS 서버 주소를 지정하는 파일" → `/etc/resolv.conf`, "IP와 호스트 이름을 직접 매핑하는 파일" → `/etc/hosts`, "고정 IP를 쓰겠다는 설정" → `BOOTPROTO=static`(또는 `none`), "부팅 시 인터페이스 활성화" → `ONBOOT=yes`. 이 넷은 꼭 기억하세요.

## 연결 점검 도구

| 명령 | 하는 일 | 예 |
|---|---|---|
| `ping` | ICMP로 상대가 응답하는지, 왕복 시간은 얼마인지 확인 | `ping -c 4 192.168.10.1` |
| `traceroute` | 목적지까지 거쳐 가는 라우터 경로 표시 | `traceroute 203.0.113.10` |
| `ss` | 열린 포트와 연결 상태 확인(netstat의 후속) | `ss -tuln` |
| `netstat` | 연결·포트·라우팅 정보(옛 명령) | `netstat -tulnp`, `netstat -r` |
| `dig` | DNS 질의 결과를 자세히 출력 | `dig example.com MX` |
| `nslookup` | DNS 질의(간단한 형식) | `nslookup www.example.com` |
| `host` | DNS 질의(가장 간단한 형식) | `host example.com` |

- 리눅스의 `ping`은 Windows와 달리 **멈출 때까지 계속** 보내요. `-c 4`처럼 횟수를 정하거나 `Ctrl + C`로 끝내요.
- 리눅스 `traceroute`는 기본으로 UDP 패킷을 쓰고, `-I` 옵션을 주면 Windows `tracert`처럼 ICMP를 써요.
- `ss`와 `netstat`의 옵션은 거의 같아요: `-t` TCP, `-u` UDP, `-l` 대기(LISTEN) 중인 것만, `-n` 이름 대신 숫자로, `-p` 사용하는 프로세스, `-a` 모두.
- `dig @192.168.10.53 example.com`처럼 `@`로 질의할 DNS 서버를 지정하고, `dig -x 192.0.2.10`으로 역방향(IP → 이름) 조회를 해요. `dig`, `nslookup`, `host`는 레드햇 계열 `bind-utils`, 데비안 계열 `dnsutils` 패키지에 들어 있어요.

```text
$ ss -tuln
Netid State  Recv-Q Send-Q  Local Address:Port   Peer Address:Port
udp   UNCONN 0      0             0.0.0.0:68          0.0.0.0:*
tcp   LISTEN 0      128           0.0.0.0:22          0.0.0.0:*
tcp   LISTEN 0      511                 *:80                *:*
```

22번(SSH)과 80번(HTTP) 포트가 연결을 기다리고 있다는 뜻이에요. Windows에서 같은 일을 하는 명령은 [Windows 네트워크 명령어](/textbook/nos-windows-commands)에서 배웠어요.

## 방화벽

방화벽의 일반 개념과 장비는 [보안 장비](/textbook/dev-security-appliances)에서 다루고, 여기서는 리눅스 서버 자체에 거는 방화벽을 배워요.

### firewalld (레드햇 계열 기본)

firewalld는 네트워크를 **영역**(Zone)으로 나누고, 영역마다 허용할 서비스와 포트를 정해요. 기본 영역은 보통 `public`이에요.

```bash
firewall-cmd --state                                  # 동작 중인지
firewall-cmd --get-default-zone                       # 기본 영역
firewall-cmd --list-all                               # 현재 영역의 허용 목록
firewall-cmd --permanent --add-service=http           # http(80) 허용을 영구 저장
firewall-cmd --permanent --add-port=8080/tcp          # 포트 번호로 허용
firewall-cmd --permanent --remove-service=http        # 허용 해제
firewall-cmd --reload                                 # 저장한 설정 적용
```

> [!WARNING]
> `--permanent` 없이 추가하면 **지금 당장만** 적용되고 다시 읽거나 재부팅하면 사라져요. 반대로 `--permanent`만 붙이면 저장은 되지만 **지금은 적용되지 않아서** `--reload`를 해야 해요. 그래서 "`--permanent`로 추가 → `--reload`"를 한 세트로 외워요. 우분투에서는 비슷한 역할로 `ufw allow 22/tcp`, `ufw enable` 같은 ufw를 많이 써요.

### iptables

iptables는 리눅스 커널의 패킷 필터(넷필터, Netfilter)에 규칙을 넣는 전통적인 도구예요. 기본 표(filter 테이블)에는 패킷이 지나는 길목마다 세 개의 **체인**(Chain)이 있어요.

| 체인 | 검사하는 패킷 |
|---|---|
| `INPUT` | 이 서버로 **들어오는** 패킷 |
| `OUTPUT` | 이 서버에서 **나가는** 패킷 |
| `FORWARD` | 이 서버를 **거쳐 다른 곳으로 지나가는** 패킷(라우터 역할일 때) |

규칙에 맞은 패킷을 어떻게 할지는 **타깃**(Target)으로 정해요.

| 타깃 | 동작 |
|---|---|
| `ACCEPT` | 통과 |
| `DROP` | 아무 응답 없이 버림 |
| `REJECT` | 버리고 거부했다는 응답을 보냄 |

| 옵션 | 뜻 |
|---|---|
| `-A 체인` / `-I 체인 [번호]` | 규칙을 맨 뒤에 추가 / 앞(지정한 위치)에 끼워 넣기 |
| `-D 체인 번호` | 규칙 삭제 |
| `-L` | 규칙 목록(`-n` 숫자로, `-v` 자세히, `--line-numbers` 번호 표시) |
| `-F` | 모든 규칙 지우기(flush) |
| `-P 체인 타깃` | 체인의 기본 정책(Policy) |
| `-p` / `--dport` | 프로토콜 / 목적지 포트 |
| `-s` / `-d` | 출발지 / 목적지 주소 |
| `-i` | 들어오는 인터페이스 |
| `-j` | 타깃으로 보내기(jump) |

```bash
# 1) 자기 자신(lo)과의 통신 허용
iptables -A INPUT -i lo -j ACCEPT
# 2) 이미 맺어진 연결의 응답 패킷 허용
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# 3) 내부망(192.168.10.0/24)에서 오는 SSH만 허용
iptables -A INPUT -p tcp --dport 22 -s 192.168.10.0/24 -j ACCEPT
# 4) 웹(80번) 허용
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
# 5) 이 주소는 1번 자리(맨 앞)에 끼워 넣어 차단
iptables -I INPUT 1 -s 203.0.113.50 -j DROP
# 6) 어느 규칙에도 맞지 않는 패킷은 모두 버림(기본 정책)
iptables -P INPUT DROP
# 결과를 번호와 함께 확인
iptables -L -n -v --line-numbers
```

규칙은 **위에서부터 차례로 비교해 처음 맞는 규칙 하나만** 적용돼요. 어느 규칙에도 맞지 않으면 체인의 기본 정책을 따르고요. 그래서 특정 주소를 막는 규칙은 `-I INPUT 1`로 맨 앞에 넣었어요. 뒤에 붙였다면 그 주소의 웹 접속이 80번 허용 규칙에 먼저 걸려 통과했을 거예요.

> [!WARNING]
> 원격(SSH)으로 접속한 상태에서 허용 규칙 없이 `iptables -P INPUT DROP`부터 실행하면 내 접속까지 끊겨요. 허용 규칙을 먼저 넣고 정책을 바꾸세요. 또 iptables 규칙도 기본적으로 메모리에만 있어서, 재부팅 후에도 유지하려면 `iptables-save`로 저장해야 해요(레드햇 계열 iptables-services는 `/etc/sysconfig/iptables`, 데비안 계열 iptables-persistent는 `/etc/iptables/rules.v4`).

> [!NOTE]
> 최신 배포판은 내부적으로 iptables의 후속인 **nftables**(`nft` 명령)를 쓰고, firewalld도 그 위에서 동작해요. 그래도 체인과 ACCEPT·DROP의 개념은 똑같아요.

## 리눅스 서버 프로그램

### 한눈에 보기

| 서비스 | 프로그램 | 패키지 (레드햇 / 데비안) | 서비스 이름 (레드햇 / 데비안) | 주요 설정 파일 | 포트 |
|---|---|---|---|---|---|
| 웹 | Apache | `httpd` / `apache2` | `httpd` / `apache2` | `/etc/httpd/conf/httpd.conf` / `/etc/apache2/apache2.conf` | TCP 80, 443 |
| 웹 | Nginx | `nginx` | `nginx` | `/etc/nginx/nginx.conf` | TCP 80, 443 |
| Windows 파일 공유 | Samba | `samba` | `smb` / `smbd` | `/etc/samba/smb.conf` | TCP 139, 445 |
| 유닉스 파일 공유 | NFS | `nfs-utils` / `nfs-kernel-server` | `nfs-server` / `nfs-kernel-server` | `/etc/exports` | TCP 2049 (rpcbind 111) |
| 파일 전송 | vsftpd | `vsftpd` | `vsftpd` | `/etc/vsftpd/vsftpd.conf` / `/etc/vsftpd.conf` | TCP 21 (데이터 20) |
| DNS | BIND | `bind` / `bind9` | `named` | `/etc/named.conf` / `/etc/bind/named.conf` | UDP·TCP 53 |
| 원격 접속 | OpenSSH | `openssh-server` | `sshd` / `ssh` | `/etc/ssh/sshd_config` | TCP 22 |
| 주소 자동 할당 | ISC DHCP | `dhcp-server` / `isc-dhcp-server` | `dhcpd` / `isc-dhcp-server` | `/etc/dhcp/dhcpd.conf` | UDP 67, 68 |

어느 서버든 운영 순서는 같아요: **패키지 설치 → 설정 파일 수정 → 서비스 시작과 자동 시작(`systemctl enable --now`) → 방화벽 허용**. 서버가 설정대로 동작하지 않을 때는 방화벽과 함께, 레드햇 계열에서 기본으로 켜져 있는 접근 통제 기능 **SELinux**(상태 확인 `getenforce`)도 의심해 보세요. 포트 번호 전체는 [UDP와 포트 번호](/textbook/tcpip-udp-ports)에서 정리했어요.

### Apache 웹 서버 (httpd)

오랫동안 가장 널리 쓰여 온 웹 서버예요. 레드햇 계열에서는 패키지와 데몬 이름이 모두 **httpd**예요.

```bash
dnf install httpd                       # 데비안 계열: apt install apache2
systemctl enable --now httpd
firewall-cmd --permanent --add-service=http
firewall-cmd --reload
```

`httpd.conf`의 주요 지시어는 이래요.

```text
ServerRoot "/etc/httpd"
Listen 80
User apache
ServerAdmin admin@example.com
ServerName www.example.com:80
DocumentRoot "/var/www/html"
DirectoryIndex index.html
```

| 지시어 | 뜻 |
|---|---|
| `ServerRoot` | 설정 파일들의 기준 디렉터리 |
| `Listen` | 접속을 기다릴 포트(기본 80) |
| `User` | 웹 서버 프로세스를 실행할 계정(레드햇 계열 `apache`, 데비안 계열 `www-data`) |
| `ServerAdmin` | 관리자 메일 주소 |
| `ServerName` | 서버의 이름 |
| `DocumentRoot` | 웹 문서를 두는 최상위 디렉터리 |
| `DirectoryIndex` | 주소에 파일 이름이 없을 때 보여 줄 기본 문서 |

- 브라우저로 `http://서버주소/`에 접속하면 `DocumentRoot`의 `index.html`이 보여요.
- 하나의 서버에서 여러 웹 사이트를 운영하는 기능을 **가상 호스트**(VirtualHost)라고 해요.
- 접속 로그와 오류 로그는 `/var/log/httpd/access_log`, `error_log`(데비안 계열 `/var/log/apache2/`)에 쌓여요.
- 설정 문법 검사는 `apachectl configtest` 또는 `httpd -t`예요.

### Nginx

**Nginx**(엔진엑스)는 적은 자원으로 많은 동시 접속을 처리하도록 이벤트 기반으로 설계된 웹 서버예요. 정적 파일 전송과, 뒤쪽 서버로 요청을 넘겨주는 리버스 프록시(Reverse Proxy)·부하 분산에 많이 쓰여요. 설정은 `/etc/nginx/nginx.conf`와 `/etc/nginx/conf.d/`에 두고, `nginx -t`로 문법을 검사해요.

### Samba — Windows와 파일 공유

**Samba**는 Windows의 파일·프린터 공유 프로토콜인 **SMB/CIFS**를 리눅스에서 구현한 프로그램이에요. 리눅스 서버의 폴더를 Windows 탐색기에서 네트워크 드라이브처럼 열 수 있어요.

```text
# /etc/samba/smb.conf
[global]
    workgroup = WORKGROUP

[team]
    path = /srv/team
    valid users = @sales
    writable = yes
    browseable = yes
```

- `[global]`은 전체 설정, `[team]`처럼 대괄호 이름이 곧 **공유 이름**이에요. `@sales`는 sales 그룹을 뜻해요.
- Samba 접속용 비밀번호는 리눅스 로그인 비밀번호와 별도로 `smbpasswd -a jiwoo`로 등록해요(리눅스 계정이 먼저 있어야 해요).
- `testparm`으로 설정 문법을 검사해요.
- Windows에서는 `\\192.168.10.20\team`으로, 리눅스에서는 `smbclient //192.168.10.20/team -U jiwoo`나 `mount -t cifs`로 접속해요.
- 데몬은 파일 공유를 맡는 `smbd`와 NetBIOS 이름 서비스를 맡는 `nmbd`예요. 포트는 TCP 139(NetBIOS 세션), TCP 445(SMB 직접), UDP 137·138(NetBIOS 이름·데이터그램)이에요.

### NFS — 리눅스·유닉스끼리 파일 공유

**NFS**(Network File System)는 다른 컴퓨터의 디렉터리를 내 디렉터리처럼 마운트해서 쓰게 해 주는 방식이에요. 서버는 `/etc/exports`에 "어떤 디렉터리를, 누구에게, 어떤 옵션으로" 공유할지 적어요.

```text
# /etc/exports
/srv/share   192.168.10.0/24(rw,sync)
/srv/pub     *(ro,sync)
```

| 옵션 | 뜻 |
|---|---|
| `rw` / `ro` | 읽기·쓰기 / 읽기 전용 |
| `sync` / `async` | 디스크에 기록한 뒤 응답 / 기록 전에 먼저 응답(빠르지만 위험) |
| `root_squash` | 클라이언트의 root를 익명 사용자(nobody)로 바꿔 권한을 낮춤(기본값) |
| `no_root_squash` | 클라이언트의 root를 서버에서도 root로 인정(위험) |
| `all_squash` | 모든 사용자를 익명 사용자로 |

```bash
exportfs -r                    # /etc/exports를 다시 읽어 공유 반영 (-a는 전체 공유)
exportfs -v                    # 현재 공유 목록
showmount -e 192.168.10.20     # (클라이언트에서) 서버가 공유 중인 목록
mount -t nfs 192.168.10.20:/srv/share /mnt/share    # 클라이언트에서 마운트
```

부팅할 때 자동으로 붙이려면 클라이언트의 `/etc/fstab`에 `192.168.10.20:/srv/share  /mnt/share  nfs  defaults  0 0`처럼 적어요.

> [!WARNING]
> `/etc/exports`에서 클라이언트와 괄호 사이에 공백을 넣으면 뜻이 완전히 달라져요. `192.168.10.0/24 (rw)`라고 쓰면 "192.168.10.0/24는 기본 옵션(읽기 전용), 그리고 **모든 호스트**에 rw"로 해석돼요. 괄호는 반드시 붙여 쓰세요.

### vsftpd — FTP 서버

**vsftpd**(Very Secure FTP Daemon)는 보안을 강조한 FTP 서버예요. 설정 파일은 레드햇 계열 `/etc/vsftpd/vsftpd.conf`, 데비안 계열 `/etc/vsftpd.conf`예요.

```text
anonymous_enable=NO
local_enable=YES
write_enable=YES
chroot_local_user=YES
```

| 설정 | 뜻 |
|---|---|
| `anonymous_enable` | 익명(anonymous) 접속 허용 여부 |
| `local_enable` | 서버의 일반 계정으로 로그인 허용 여부 |
| `write_enable` | 업로드·삭제 같은 쓰기 허용 여부 |
| `chroot_local_user` | `YES`면 사용자를 자기 홈 디렉터리 안에 가둬 위로 못 올라가게 함 |

- `ftpusers` 파일(레드햇 계열 `/etc/vsftpd/ftpusers`)에 적힌 계정은 FTP 접속이 거부돼요. root가 기본으로 들어 있어요.
- FTP는 제어용 21번과 데이터용 20번(액티브 모드) 포트를 써요. 패시브 모드에서는 서버가 알려 준 임의의 높은 포트로 데이터를 주고받아요. FTP는 암호화가 없어서 요즘은 SFTP(SSH 기반)나 FTPS를 권장해요.

### BIND — DNS 서버

리눅스의 대표 DNS 서버 프로그램은 **BIND**(Berkeley Internet Name Domain)이고, 실행되는 데몬 이름은 **named**예요. DNS의 원리와 레코드 종류는 [DNS와 DHCP](/textbook/tcpip-dns-dhcp)에서 배웠어요.

```text
// /etc/named.conf (레드햇 계열)
options {
    listen-on port 53 { any; };     // 질의를 받을 주소와 포트
    directory "/var/named";         // 존 파일이 있는 디렉터리
    allow-query { any; };           // 질의를 받아 줄 대상
};

zone "example.com" IN {
    type master;                    // 이 서버가 원본(주) 서버
    file "example.com.zone";        // /var/named/example.com.zone
};
```

레드햇 계열이 처음 설치해 주는 named.conf에는 `listen-on`과 `allow-query`가 자기 자신(127.0.0.1, localhost)으로만 되어 있어요. 다른 컴퓨터의 질의를 받으려면 위처럼 바꿔 줘야 해요.

도메인의 실제 레코드는 **존 파일**(Zone File)에 적어요.

```text
$TTL 1D
@     IN SOA  ns1.example.com. admin.example.com. (
              2026101401 ; serial  (고칠 때마다 올리는 일련번호)
              1H         ; refresh
              15M        ; retry
              1W         ; expire
              1D )       ; minimum
      IN NS   ns1.example.com.
      IN MX   10 mail.example.com.
ns1   IN A    192.168.10.53
www   IN A    192.168.10.20
mail  IN A    192.168.10.25
ftp   IN CNAME www
```

- `@`는 이 존의 도메인 자체(example.com)를 뜻해요.
- 이름 끝의 **점**(.)은 "여기서 끝나는 완전한 이름(FQDN)"이라는 표시예요. 점이 없는 `www`나 `ftp`에는 뒤에 `example.com.`이 자동으로 붙어요. 완전한 이름을 쓰면서 점을 빠뜨리면 `ns1.example.com.example.com.`처럼 엉뚱한 이름이 되는 흔한 실수가 생겨요.
- SOA의 `admin.example.com.`은 관리자 메일 주소 `admin@example.com`을 뜻해요(@ 대신 점).
- `named-checkconf`로 named.conf를, `named-checkzone example.com /var/named/example.com.zone`으로 존 파일을 검사하고, `rndc reload`로 다시 읽어요.
- 데비안 계열은 설정이 `/etc/bind/` 아래에 나뉘어 있고, 예전 버전에서는 서비스 이름이 `bind9`이었어요.

> [!NOTE]
> 최근 BIND 버전에서는 `type master`를 `type primary`로, 보조 서버의 `type slave`를 `type secondary`로도 쓸 수 있어요. 시험과 기존 설정 파일에서는 master/slave 표기를 많이 봐요.

### sshd — SSH 서버

**SSH**(Secure Shell)는 암호화된 원격 접속 프로토콜이에요. 서버 프로그램은 OpenSSH의 **sshd**이고, 설정 파일은 `/etc/ssh/sshd_config`예요.

```text
Port 22
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AllowUsers jiwoo minsu
```

| 설정 | 뜻 |
|---|---|
| `Port` | 접속을 기다릴 포트(기본 22) |
| `PermitRootLogin` | root 계정의 직접 로그인 허용 여부 |
| `PasswordAuthentication` | 비밀번호 로그인 허용 여부(`no`면 키 인증만) |
| `PubkeyAuthentication` | 공개 키 인증 허용 여부 |
| `AllowUsers` | 적힌 사용자만 접속 허용 |

- `PermitRootLogin`은 `yes`, `no`, `prohibit-password`(키 인증일 때만 root 허용) 등을 쓸 수 있어요. 최근 OpenSSH의 기본값은 `prohibit-password`예요. 보안을 위해 `no`로 두고, 일반 계정으로 들어온 뒤 `sudo`를 쓰는 것이 일반적이에요.
- 설정을 바꾼 뒤에는 `sshd -t`로 문법을 검사하고 `systemctl restart sshd`(데비안 계열 `ssh`)로 적용해요.
- 클라이언트 쪽 명령: `ssh jiwoo@192.168.10.20`, 포트가 다르면 `ssh -p 2222 ...`, 파일 복사는 `scp`, 키 만들기는 `ssh-keygen`, 서버에 공개 키 등록은 `ssh-copy-id`.

> [!WARNING]
> `/etc/ssh/sshd_config`는 **서버** 설정이고, 이름이 비슷한 `/etc/ssh/ssh_config`는 이 컴퓨터에서 다른 곳으로 접속할 때 쓰는 **클라이언트** 설정이에요. d 한 글자 차이를 노리는 문제가 나와요.

### DHCP 서버

```text
# /etc/dhcp/dhcpd.conf
subnet 192.168.10.0 netmask 255.255.255.0 {
    range 192.168.10.100 192.168.10.200;          # 나눠 줄 주소 범위
    option routers 192.168.10.1;                  # 기본 게이트웨이
    option domain-name-servers 192.168.10.53;     # DNS 서버
    option domain-name "example.com";
    default-lease-time 600;                       # 기본 임대 시간(초)
    max-lease-time 7200;                          # 최대 임대 시간(초)
}

host printer1 {                                   # 특정 장비에 항상 같은 주소
    hardware ethernet 52:54:00:aa:bb:cc;
    fixed-address 192.168.10.50;
}
```

- 서비스 이름은 레드햇 계열 `dhcpd`, 데비안 계열 `isc-dhcp-server`예요. 서버는 UDP 67, 클라이언트는 UDP 68번 포트를 써요.
- 어떤 주소를 누구에게 빌려줬는지는 임대 파일(레드햇 계열 `/var/lib/dhcpd/dhcpd.leases`)에 기록돼요.
- ISC DHCP는 개발사가 유지 보수를 끝내고 후속 프로그램인 Kea로 옮겨 가도록 권하고 있어요. 그래도 설정 개념(범위, 게이트웨이, DNS, 임대 시간, 고정 할당)은 같아요.

> [!TIP]
> 메일 서버도 알아 두면 좋아요. 메일을 보내고 전달하는 SMTP(25번) 서버는 Postfix나 Sendmail, 메일함에서 꺼내 읽는 POP3(110번)·IMAP(143번) 서버는 Dovecot이 대표적이에요.

## 핵심 정리

- 새 명령 `ip addr`·`ip route`·`ip neigh`·`ss`가 옛 명령 `ifconfig`·`route`·`arp`·`netstat`을 대신해요. 명령으로 바꾼 설정은 임시예요.
- 영구 설정은 `nmcli`(NetworkManager) 또는 설정 파일. 예전 레드햇 계열은 `/etc/sysconfig/network-scripts/ifcfg-*`(`BOOTPROTO`, `IPADDR`, `ONBOOT`).
- `/etc/hosts` 이름과 IP 직접 매핑, `/etc/resolv.conf` DNS 서버(`nameserver`), `/etc/hostname` 호스트 이름(`hostnamectl set-hostname`).
- 점검: `ping -c`, `traceroute`, `ss -tuln`(`netstat`), `dig`·`nslookup`.
- firewalld: `firewall-cmd --permanent --add-service=http` 다음 `--reload`.
- iptables 체인 INPUT(들어옴)·OUTPUT(나감)·FORWARD(통과), 타깃 ACCEPT·DROP·REJECT, 위에서부터 처음 맞는 규칙 적용.
- Apache: 레드햇 `httpd`, `httpd.conf`, `DocumentRoot /var/www/html`, 80번.
- Samba: `smb.conf`, Windows 파일 공유, `smbpasswd -a`, 139·445번 / NFS: `/etc/exports`, `exportfs -r`, `mount -t nfs`.
- vsftpd 21번(데이터 20번), BIND 데몬 `named`·`named.conf`·존 파일 `/var/named`, sshd `sshd_config`의 `PermitRootLogin`, DHCP `dhcpd.conf`.

## 스스로 확인하기

**1.** 리눅스 서버가 이름을 해석할 때 사용할 DNS 서버의 IP 주소를 지정하는 파일은?
① `/etc/hosts` ② `/etc/hostname` ③ `/etc/resolv.conf` ④ `/etc/services`

> [!ANSWER]
> 정답: ③
> `/etc/resolv.conf`의 `nameserver` 줄에 DNS 서버 주소를 적어요. `/etc/hosts`는 이름과 IP를 직접 짝지어 둔 파일이에요.

**2.** firewalld를 쓰는 서버에서 HTTPS 서비스를 재부팅 후에도 허용되게 하고 지금 바로 적용하려면 어떻게 해야 할까요?
① `firewall-cmd --add-service=https`만 실행 ② `firewall-cmd --permanent --add-service=https` 후 `firewall-cmd --reload` ③ `iptables -L` 실행 ④ `firewall-cmd --reload` 후 `firewall-cmd --add-service=https`

> [!ANSWER]
> 정답: ②
> `--permanent`로 영구 설정에 저장하고 `--reload`로 지금 적용해요. ①은 재부팅하면 사라지고, ④는 다시 읽은 뒤 임시로만 추가한 것이에요.

**3.** iptables에서 다른 컴퓨터로 가기 위해 이 서버를 **거쳐 지나가는** 패킷을 검사하는 체인은?
① INPUT ② OUTPUT ③ FORWARD ④ POLICY

> [!ANSWER]
> 정답: ③
> 서버 자신에게 들어오는 패킷은 INPUT, 자신이 내보내는 패킷은 OUTPUT, 서버를 통과해 다른 곳으로 가는 패킷은 FORWARD 체인에서 검사해요.

**4.** 한빛상사는 리눅스 서버의 폴더를 사원들의 Windows PC에서 네트워크 드라이브로 열어 쓰려고 해요. 가장 알맞은 서버 프로그램과 설정 파일의 짝은?
① NFS — `/etc/exports` ② Samba — `/etc/samba/smb.conf` ③ vsftpd — `/etc/vsftpd/vsftpd.conf` ④ BIND — `/etc/named.conf`

> [!ANSWER]
> 정답: ②
> Windows의 파일 공유 프로토콜(SMB/CIFS)을 지원하는 것은 Samba예요. NFS는 주로 리눅스·유닉스끼리 파일을 공유할 때 써요.

**5.** SSH 서버에서 root 계정으로 직접 로그인하는 것을 막으려면 어느 파일에 어떤 설정을 해야 할까요?
① `/etc/ssh/ssh_config`에 `PermitRootLogin no` ② `/etc/ssh/sshd_config`에 `PermitRootLogin no` ③ `/etc/ssh/sshd_config`에 `PasswordAuthentication yes` ④ `/etc/securetty`에 `AllowUsers root`

> [!ANSWER]
> 정답: ②
> 서버 설정 파일은 `sshd_config`이고, root 직접 로그인 여부는 `PermitRootLogin`으로 정해요. `ssh_config`는 클라이언트 설정이에요.
