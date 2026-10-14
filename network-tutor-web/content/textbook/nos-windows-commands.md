"인터넷이 안 돼요"라는 연락을 받으면 관리자가 가장 먼저 여는 것이 명령 프롬프트예요. 이 단원에서는 시험에 자주 나오는 Windows 네트워크 명령어를 용도별로 정리하고, 실제 출력 예를 읽는 법과 같은 일을 하는 PowerShell 명령까지 함께 익혀요. 각 명령이 보여 주는 정보의 의미는 앞에서 배운 [ARP·ICMP·IGMP](/textbook/tcpip-arp-icmp), [DNS와 DHCP](/textbook/tcpip-dns-dhcp), [라우팅의 원리](/textbook/tcpip-routing-basics)와 연결되니 필요하면 돌아가서 확인하세요.

> [!GOAL]
> - ipconfig·ping·tracert·pathping·nslookup의 주요 옵션을 알고 출력을 해석할 수 있다
> - netstat·arp·route로 연결 상태, ARP 캐시, 라우팅 테이블을 확인하고 바꿀 수 있다
> - hostname·getmac·nbtstat·net·netsh·shutdown의 쓰임을 구분할 수 있다
> - 주요 명령에 대응하는 PowerShell cmdlet을 말할 수 있다

## 한눈에 보는 명령어

| 명령 | 용도 | 비슷한 PowerShell cmdlet |
|---|---|---|
| `ipconfig` | IP 설정 확인, DHCP 주소 반납·갱신, DNS 캐시 관리 | `Get-NetIPConfiguration`, `Clear-DnsClientCache` |
| `ping` | 상대에게 도달할 수 있는지, 왕복 시간은 얼마인지 | `Test-Connection` |
| `tracert` | 목적지까지 거치는 라우터(홉) 경로 | `Test-NetConnection -TraceRoute` |
| `pathping` | 경로 + 구간별 패킷 손실률 | — |
| `nslookup` | DNS 서버에 직접 질의 | `Resolve-DnsName` |
| `netstat` | 연결 상태, 열린 포트, 프로토콜 통계 | `Get-NetTCPConnection` |
| `arp` | ARP 캐시(IP ↔ MAC) 보기·수정 | `Get-NetNeighbor` |
| `route` | 라우팅 테이블 보기·수정 | `Get-NetRoute`, `New-NetRoute` |
| `hostname` | 컴퓨터 이름 | `$env:COMPUTERNAME` |
| `getmac` | 네트워크 어댑터의 MAC 주소 | `Get-NetAdapter` |
| `nbtstat` | NetBIOS 이름과 캐시 | — |
| `net` | 사용자, 공유, 네트워크 드라이브, 서비스 관리 | `Get-LocalUser`, `Get-SmbShare`, `Start-Service` 등 |
| `netsh` | 인터페이스·방화벽 등 네트워크 설정 변경 | `New-NetIPAddress`, `New-NetFirewallRule` 등 |
| `shutdown` | 종료, 다시 시작, 로그오프 | `Stop-Computer`, `Restart-Computer` |

라우팅 테이블이나 ARP 캐시를 바꾸는 명령, netsh로 설정을 바꾸는 명령은 '관리자 권한으로 실행'한 명령 프롬프트에서 써야 해요. 아래 출력 예는 한국어 Windows 기준이며, 버전에 따라 문구와 간격이 조금 다를 수 있어요.

## ipconfig

### 옵션

| 옵션 | 하는 일 |
|---|---|
| (옵션 없음) | 어댑터별 IPv4·IPv6 주소, 서브넷 마스크, 기본 게이트웨이 |
| `/all` | 위 내용 + 호스트 이름, MAC 주소(물리적 주소), DHCP 사용 여부, DHCP 서버, 임대 시작·만료 시각, DNS 서버 |
| `/release` | DHCP로 받은 IPv4 주소를 반납(IPv6는 `/release6`) |
| `/renew` | DHCP 서버에 주소를 새로 요청·갱신(IPv6는 `/renew6`) |
| `/flushdns` | DNS 확인자 캐시를 비움 |
| `/displaydns` | DNS 확인자 캐시 내용을 보여 줌 |
| `/registerdns` | DHCP 임대를 새로 고치고 DNS 서버에 이름을 다시 등록 |

### 출력 읽기

```text
C:\> ipconfig /all

Windows IP 구성

   호스트 이름 . . . . . . . . : PC-MINSU
   주 DNS 접미사 . . . . . . . : hanbit.example.com

이더넷 어댑터 이더넷:

   물리적 주소 . . . . . . . . : 00-1A-2B-3C-4D-5E
   DHCP 사용 . . . . . . . . . : 예
   IPv4 주소 . . . . . . . . . : 192.168.10.25(기본 설정)
   서브넷 마스크 . . . . . . . : 255.255.255.0
   임대 시작 날짜. . . . . . . : 2026년 10월 14일 수요일 오전 9:00:12
   임대 만료 날짜. . . . . . . : 2026년 10월 22일 목요일 오전 9:00:12
   기본 게이트웨이 . . . . . . : 192.168.10.1
   DHCP 서버 . . . . . . . . . : 192.168.10.11
   DNS 서버. . . . . . . . . . : 192.168.10.10
```

- 물리적 주소가 이 어댑터의 MAC 주소예요.
- DHCP 사용이 '예'이고 임대 기간이 8일이니 Windows DHCP 서버의 기본 임대 기간으로 주소를 받은 상태예요.
- IPv4 주소가 169.254.x.x로 나오면 DHCP 서버를 찾지 못해 스스로 정한 APIPA 주소예요. 케이블과 DHCP 서버를 확인한 뒤 `/release`, `/renew`를 해 봐요.

> [!WARNING]
> 원격 데스크톱으로 접속한 상태에서 `ipconfig /release`를 실행하면 그 순간 연결이 끊겨 `/renew`를 입력할 수 없어요. 원격에서는 명령 프롬프트에 `ipconfig /release && ipconfig /renew`처럼 한 줄로 이어서 입력하거나 현장에서 작업해요.

## ping

`ping`은 ICMP 에코 요청(Echo Request)을 보내고 에코 응답(Echo Reply)이 돌아오는지 확인해요. 기본으로 32바이트짜리 데이터를 4번 보내요.

| 옵션 | 뜻 | 예 |
|---|---|---|
| `-t` | Ctrl+C로 멈출 때까지 계속 보냄(Ctrl+Break는 중간 통계) | `ping -t 192.168.10.1` |
| `-n 횟수` | 보낼 횟수 지정 | `ping -n 10 192.168.10.1` |
| `-l 크기` | 보낼 데이터 크기(바이트) 지정 | `ping -l 1000 192.168.10.1` |
| `-a` | 대상 IP 주소를 호스트 이름으로 바꿔서 표시 | `ping -a 192.168.10.20` |
| `-i TTL` | 보낼 패킷의 TTL 지정 | `ping -i 5 192.168.10.1` |
| `-w 시간` | 응답 대기 시간(밀리초) | `ping -w 2000 192.168.10.1` |
| `-f` | 단편화 금지(DF) 비트 설정, MTU 확인에 사용 | `ping -f -l 1472 192.168.10.1` |
| `-4` / `-6` | IPv4 / IPv6 강제 | `ping -6 fs01` |

```text
C:\> ping -n 3 192.168.10.1

Ping 192.168.10.1 32바이트 데이터 사용:
192.168.10.1의 응답: 바이트=32 시간=1ms TTL=64
192.168.10.1의 응답: 바이트=32 시간<1ms TTL=64
192.168.10.1의 응답: 바이트=32 시간<1ms TTL=64

192.168.10.1에 대한 Ping 통계:
    패킷: 보냄 = 3, 받음 = 3, 손실 = 0 (0% 손실),
왕복 시간(밀리초):
    최소 = 0ms, 최대 = 1ms, 평균 = 0ms
```

- 시간: 왕복 시간(RTT)이에요. 같은 LAN이라면 1ms 안팎이 보통이에요.
- TTL: 응답 패킷이 도착했을 때 남은 TTL이에요. 운영체제마다 시작값이 달라서(흔히 리눅스 계열 64, Windows 128) 상대가 어떤 시스템인지 대략 짐작하는 데 쓰기도 해요.

실패했을 때 나오는 메시지도 의미가 달라요.

| 메시지 | 뜻 |
|---|---|
| 요청 시간이 만료되었습니다. | 응답이 오지 않음. 상대가 꺼졌거나, 방화벽이 ICMP를 막았거나, 돌아오는 경로에 문제가 있음 |
| 대상 호스트에 연결할 수 없습니다. | 내 PC나 중간 라우터가 대상까지 갈 방법을 찾지 못함 |
| Ping 요청에서 www.example.com 호스트를 찾을 수 없습니다. | 이름을 IP 주소로 바꾸지 못함(DNS 문제) |

> [!TIP]
> 연결 문제를 찾을 때는 가까운 곳부터 차례로 ping 해 보세요. 127.0.0.1(내 TCP/IP 스택) → 내 IP → 기본 게이트웨이 → 외부 IP 주소 → 외부 도메인 이름 순서예요. IP로는 되는데 이름으로만 안 되면 DNS 문제예요.

> [!WARNING]
> Windows 방화벽은 들어오는 ping(ICMP 에코 요청)을 기본으로 막는 경우가 많아요. ping에 응답이 없다고 해서 그 서버가 꺼졌다고 단정하면 안 돼요.

## tracert와 pathping

### tracert

`tracert`는 목적지까지 거치는 라우터를 차례로 보여 줘요. TTL을 1부터 하나씩 늘려 가며 패킷을 보내면, TTL이 0이 되는 지점의 라우터가 ICMP 시간 초과(Time Exceeded) 메시지를 돌려보내요. 이 메시지를 보낸 주소를 모으면 경로가 돼요. Windows의 `tracert`는 ICMP 에코 요청을 쓰고, 리눅스의 `traceroute`는 기본으로 UDP를 써요.

| 옵션 | 뜻 |
|---|---|
| `-d` | 주소를 이름으로 바꾸지 않음(결과가 빨리 나옴) |
| `-h 최대홉` | 최대 홉 수(기본 30) |
| `-w 시간` | 각 응답의 대기 시간(밀리초) |

```text
C:\> tracert -d 203.0.113.80

최대 30홉 이상의
203.0.113.80(으)로 가는 경로 추적:

  1    <1 ms    <1 ms    <1 ms  192.168.10.1
  2     3 ms     2 ms     3 ms  198.51.100.1
  3     *        *        *     요청 시간이 만료되었습니다.
  4     9 ms     8 ms     9 ms  203.0.113.80

추적을 완료했습니다.
```

각 홉마다 세 번씩 보내서 왕복 시간이 세 개 나와요. `*`는 그 시도에 응답이 없었다는 뜻이에요. 3번 홉처럼 중간에 `*`가 나와도 그다음 홉이 응답하면, 그 라우터가 ICMP 응답을 보내지 않도록 설정되어 있을 뿐 통신은 정상이에요. 반대로 어느 홉 이후로 계속 `*`만 나오면 그 근처에서 끊긴 거예요.

### pathping

`pathping`은 tracert처럼 경로를 먼저 찾은 뒤, 각 홉에 일정 시간 동안 여러 번(기본 홉당 100번) 패킷을 보내서 구간별 패킷 손실률을 계산해요. 어느 구간에서 손실이 생기는지 정확히 짚을 수 있지만, 기본 설정에서 홉 하나에 약 25초씩 걸려서 결과가 나오기까지 오래 기다려야 해요. `-n`(이름 해석 안 함), `-h`(최대 홉), `-q`(홉당 보낼 횟수) 옵션을 써요.

## nslookup

`nslookup`은 DNS 서버에 직접 질의해서 이름 해석이 제대로 되는지 확인하는 도구예요. 명령 줄에서 한 번에 묻는 비대화형 방식과, `>` 프롬프트에서 여러 번 묻는 대화형 방식이 있어요.

### 비대화형

```text
C:\> nslookup www.example.com
서버:    dns01.hanbit.example.com
Address:  192.168.10.10

권한 없는 응답:
이름:    www.example.com
Address:  203.0.113.80
```

- 첫 두 줄은 질의를 받은 DNS 서버예요.
- '권한 없는 응답(Non-authoritative answer)'은 그 영역을 직접 관리하는 서버가 아니라 캐시나 다른 서버를 거쳐 얻은 답이라는 뜻이에요. 오류가 아니에요.
- `nslookup www.example.com 192.168.10.11`처럼 끝에 서버 주소를 붙이면 그 DNS 서버에 물어봐요.
- `nslookup -type=mx example.com`처럼 레코드 종류를 지정할 수도 있어요.

### 대화형

```text
C:\> nslookup
기본 서버:  dns01.hanbit.example.com
Address:  192.168.10.10

> set type=mx
> example.com
example.com     MX preference = 10, mail exchanger = mail.example.com
> server 192.168.10.11
> set type=a
> www.example.com
> exit
```

- `set type=레코드종류`(또는 `set q=`)로 a, aaaa, mx, ns, soa, ptr, cname, srv, txt 등을 골라요.
- `server 주소`로 질의할 DNS 서버를 바꿔요.
- 이름 대신 IP 주소를 입력하면 역방향(PTR) 질의를 해요.
- `exit`로 빠져나와요.

## netstat

`netstat`은 이 컴퓨터의 네트워크 연결과 열려 있는 포트, 프로토콜 통계를 보여 줘요.

| 옵션 | 뜻 |
|---|---|
| `-a` | 모든 연결과 연결을 기다리는(LISTENING) 포트 |
| `-n` | 주소와 포트를 이름으로 바꾸지 않고 숫자로(빠름) |
| `-o` | 연결을 가진 프로세스 ID(PID) |
| `-b` | 연결을 만든 실행 파일 이름(관리자 권한 필요) |
| `-r` | 라우팅 테이블(`route print`와 같은 내용) |
| `-e` | 이더넷 통계(주고받은 바이트·패킷 수, 오류 수) |
| `-s` | 프로토콜별(IP, ICMP, TCP, UDP) 통계 |
| `-p 프로토콜` | 지정한 프로토콜만(예: `-p tcp`) |

```text
C:\> netstat -ano

활성 연결

  프로토콜  로컬 주소            외부 주소            상태          PID
  TCP    0.0.0.0:135          0.0.0.0:0            LISTENING     1012
  TCP    0.0.0.0:3389         0.0.0.0:0            LISTENING     1240
  TCP    192.168.10.25:51022  192.168.10.30:445    ESTABLISHED   4
  TCP    192.168.10.25:51210  203.0.113.80:443     TIME_WAIT     0
  UDP    0.0.0.0:123          *:*                                1380
```

- 로컬 주소 `0.0.0.0:3389`가 LISTENING이면 모든 인터페이스에서 원격 데스크톱 접속을 기다리고 있다는 뜻이에요.
- 세 번째 줄은 이 PC가 파일 서버(192.168.10.30)의 445번 포트(SMB)에 연결된 상태예요.
- UDP는 연결 개념이 없어서 상태 칸이 비어 있어요.

| 상태 | 뜻 |
|---|---|
| LISTENING | 연결 요청을 기다리는 중(서버 포트가 열려 있음) |
| ESTABLISHED | 연결이 맺어져 데이터를 주고받는 중 |
| SYN_SENT | 연결 요청(SYN)을 보내고 응답을 기다리는 중 |
| TIME_WAIT | 연결을 끝낸 뒤 늦게 도착할 패킷에 대비해 잠시 기다리는 중 |
| CLOSE_WAIT | 상대가 종료를 요청했고, 내 쪽 프로그램이 정리하기를 기다리는 중 |

포트를 어떤 프로그램이 쓰는지 알고 싶으면 PID를 이어서 찾아요.

```text
C:\> netstat -ano | findstr :3389
C:\> tasklist /fi "PID eq 1240"
```

## arp

`arp`는 IP 주소와 MAC 주소의 대응표인 ARP 캐시를 보여 주거나 고쳐요.

| 옵션 | 뜻 | 예 |
|---|---|---|
| `-a` | ARP 캐시 보기(`-g`도 같음) | `arp -a` |
| `-d` | 항목 삭제(`*`이면 전체) | `arp -d 192.168.10.1` |
| `-s` | 정적 항목 추가 | `arp -s 192.168.10.1 00-1a-2b-3c-4d-5e` |

```text
C:\> arp -a

인터페이스: 192.168.10.25 --- 0xc
  인터넷 주소           물리적 주소           유형
  192.168.10.1          00-1a-2b-3c-4d-5e     동적
  192.168.10.30         00-1a-2b-11-22-33     동적
  192.168.10.255        ff-ff-ff-ff-ff-ff     정적
  224.0.0.22            01-00-5e-00-00-16     정적
```

- 동적: ARP 요청과 응답으로 알아낸 항목이에요. 일정 시간 쓰지 않으면 사라져요.
- 정적: 직접 넣은 항목이나 브로드캐스트·멀티캐스트 주소처럼 고정된 항목이에요.
- 서로 다른 IP 주소 여러 개가 같은 MAC 주소로 나오고, 그중 하나가 게이트웨이라면 ARP 스푸핑을 의심해 봐요. 게이트웨이 항목을 정적으로 넣어 두는 것이 간단한 대비책이에요.

> [!NOTE]
> 최신 Windows에서는 같은 일을 `netsh interface ipv4 add neighbors "이더넷" 192.168.10.1 00-1a-2b-3c-4d-5e`로도 할 수 있어요. `arp -s`가 거부될 때 이 방법을 써요.

## route

### 라우팅 테이블 보기

```text
C:\> route print -4

IPv4 경로 테이블
=====================================================================
활성 경로:
네트워크 대상    네트워크 마스크    게이트웨이      인터페이스     메트릭
      0.0.0.0          0.0.0.0    192.168.10.1   192.168.10.25     25
    127.0.0.0        255.0.0.0          연결됨       127.0.0.1    331
 192.168.10.0    255.255.255.0          연결됨   192.168.10.25    281
192.168.10.25  255.255.255.255          연결됨   192.168.10.25    281
=====================================================================
영구 경로:
  없음
```

- `0.0.0.0` / `0.0.0.0`은 기본 경로(Default Route)예요. 다른 항목에 맞지 않는 모든 목적지는 게이트웨이 192.168.10.1로 보내요.
- '연결됨(On-link)'은 같은 네트워크에 있어서 게이트웨이를 거치지 않고 바로 보낸다는 뜻이에요.
- 메트릭(Metric)은 경로의 비용으로, 같은 목적지에 경로가 여러 개면 값이 작은 쪽을 써요.
- `netstat -r`도 같은 표를 보여 줘요.

### 경로 추가, 변경, 삭제

```text
C:\> route add 10.20.0.0 mask 255.255.0.0 192.168.10.254 metric 10
C:\> route -p add 10.20.0.0 mask 255.255.0.0 192.168.10.254
C:\> route change 10.20.0.0 mask 255.255.0.0 192.168.10.253
C:\> route delete 10.20.0.0
```

첫 줄은 10.20.0.0/16 네트워크로 가는 패킷을 192.168.10.254 라우터로 보내라는 경로를 추가해요. 이렇게 추가한 경로는 다시 시작하면 사라져요. 둘째 줄처럼 `-p`를 붙이면 영구 경로(Persistent Route)로 저장되어 다시 시작한 뒤에도 남고, `route print`의 '영구 경로' 부분에 나와요.

> [!EXAM]
> "재부팅 후에도 유지되는 정적 경로를 추가하는 옵션"은 `-p`예요. `route print`와 `netstat -r`이 같은 결과를 보여 준다는 점도 자주 나와요.

## 그 밖의 명령

### hostname과 getmac

```text
C:\> hostname
PC-MINSU

C:\> getmac

물리적 주소           전송 이름
===================  ==========================
00-1A-2B-3C-4D-5E    \Device\Tcpip_{3F2A...}
```

`hostname`은 컴퓨터 이름만 짧게 보여 줘요. `getmac`은 어댑터별 MAC 주소를 보여 주고, `/v`를 붙이면 연결 이름과 어댑터 이름까지, `/s 컴퓨터이름`을 붙이면 원격 컴퓨터의 MAC 주소를 보여 줘요. MAC 주소는 `ipconfig /all`의 '물리적 주소'로도 확인할 수 있어요.

### nbtstat

`nbtstat`은 NetBIOS over TCP/IP(NetBT)의 상태를 보여 줘요. NetBIOS 이름은 예전 Windows 네트워크에서 쓰던 15자 이하의 컴퓨터 이름이에요.

| 옵션 | 뜻 |
|---|---|
| `-n` | 내 컴퓨터에 등록된 NetBIOS 이름 |
| `-c` | NetBIOS 이름 캐시 내용 |
| `-a 이름` | 원격 컴퓨터의 이름 테이블(컴퓨터 이름으로 지정) |
| `-A IP주소` | 원격 컴퓨터의 이름 테이블(IP 주소로 지정) |
| `-R` | 이름 캐시를 비우고 LMHOSTS 파일을 다시 읽음 |
| `-RR` | WINS 서버에 등록한 이름을 해제한 뒤 다시 등록 |
| `-r` | 브로드캐스트와 WINS로 해석한 이름 통계 |
| `-s` / `-S` | 세션 목록(상대를 이름으로 / IP 주소로 표시) |

> [!EXAM]
> nbtstat 옵션은 대소문자를 구분해요. `-a`는 이름, `-A`는 IP 주소로 원격 컴퓨터를 지정하고, `-r`은 통계, `-R`은 캐시 다시 읽기예요.

### net 명령

| 명령 | 하는 일 |
|---|---|
| `net user` | 로컬 사용자 목록 |
| `net user minsu * /add` | 사용자 minsu 추가(암호는 화면에서 입력) |
| `net user minsu /active:no` | 계정 사용 안 함 |
| `net user minsu /delete` | 사용자 삭제 |
| `net localgroup Administrators minsu /add` | 로컬 그룹에 구성원 추가 |
| `net share` | 이 컴퓨터의 공유 목록 |
| `net share Sales=D:\Sales /grant:Everyone,READ` | 공유 만들기(권한 READ, CHANGE, FULL 중 선택) |
| `net share Sales /delete` | 공유 해제 |
| `net use Z: \\FS01\Sales /persistent:yes` | Z: 드라이브로 네트워크 공유 연결(다음 로그온 때도 유지) |
| `net use Z: /delete` | 네트워크 드라이브 연결 끊기 |
| `net start` | 실행 중인 서비스 목록 |
| `net start spooler` / `net stop spooler` | 서비스 시작 / 중지 |
| `net accounts` | 암호 길이·사용 기간 같은 계정 정책 확인 |
| `net session` | 이 컴퓨터에 연결된 다른 컴퓨터의 세션 |

`net user`에 `/domain`을 붙이면 도메인 계정을 대상으로 해요. 서비스는 `net start`와 `net stop`만 있고 '다시 시작' 명령은 따로 없어서, 중지한 뒤 다시 시작해요.

### netsh

`netsh`(Network Shell)는 네트워크 설정을 명령으로 바꾸는 도구예요. 인터페이스 주소, 방화벽, 무선 프로필 등을 다뤄요.

```text
C:\> netsh interface ipv4 show config
C:\> netsh interface ipv4 set address name="이더넷" static 192.168.10.25 255.255.255.0 192.168.10.1
C:\> netsh interface ipv4 set dnsservers name="이더넷" static 192.168.10.10 primary
C:\> netsh interface ipv4 set address name="이더넷" dhcp
C:\> netsh advfirewall firewall add rule name="ICMPv4 허용" dir=in action=allow protocol=icmpv4:8,any
```

위에서부터 현재 설정 보기, 고정 IP·마스크·게이트웨이 지정, DNS 서버 지정, DHCP로 되돌리기, 들어오는 ping 허용 규칙 추가예요. Microsoft는 이런 설정에 PowerShell cmdlet을 쓰도록 권장하고 있어요.

### shutdown

| 옵션 | 뜻 |
|---|---|
| `/s` | 종료 |
| `/r` | 다시 시작 |
| `/l` | 로그오프 |
| `/t 초` | 기다릴 시간(0이면 즉시) |
| `/a` | 예약된 종료 취소 |
| `/f` | 실행 중인 프로그램을 강제로 닫음 |
| `/m \\컴퓨터` | 원격 컴퓨터 대상 |
| `/c "메시지"` | 사용자에게 보여 줄 사유 |

```text
C:\> shutdown /r /t 60 /c "업데이트 적용을 위해 1분 뒤 다시 시작합니다"
C:\> shutdown /a
```

## PowerShell로 하기

PowerShell에서는 같은 정보를 객체로 받아 걸러 보거나 다른 명령에 넘기기 쉬워요.

```powershell
Get-NetIPConfiguration                       # ipconfig 비슷
Test-Connection 192.168.10.1 -Count 4         # ping
Test-NetConnection fs01 -Port 445             # 특정 TCP 포트가 열려 있는지
Test-NetConnection 203.0.113.80 -TraceRoute   # tracert 비슷
Resolve-DnsName example.com -Type MX          # nslookup
Clear-DnsClientCache                          # ipconfig /flushdns
Get-NetTCPConnection -State Listen            # netstat의 LISTENING 포트
Get-NetNeighbor -AddressFamily IPv4           # arp -a
Get-NetRoute -AddressFamily IPv4              # route print
New-NetRoute -DestinationPrefix 10.20.0.0/16 -InterfaceAlias "이더넷" -NextHop 192.168.10.254
```

`Test-NetConnection`은 ping으로는 알 수 없는 'TCP 포트가 열려 있는지'까지 확인해 줘서 특히 유용해요.

```text
ComputerName     : fs01
RemoteAddress    : 192.168.10.30
RemotePort       : 445
InterfaceAlias   : 이더넷
SourceAddress    : 192.168.10.25
TcpTestSucceeded : True
```

`TcpTestSucceeded : True`이면 fs01의 445번 포트까지 TCP 연결이 맺어졌다는 뜻이에요.

## 상황별로 고르기

| 상황 | 먼저 쓸 명령 |
|---|---|
| 내 IP, 게이트웨이, DNS 서버, MAC 주소를 알고 싶다 | `ipconfig /all` |
| 주소가 169.254.x.x로 잡혔다 | `ipconfig /release` → `ipconfig /renew` |
| IP로는 접속되는데 이름으로는 안 된다 | `nslookup`, `ipconfig /flushdns` |
| 어디서 끊기는지 알고 싶다 | `tracert`, 손실 구간까지는 `pathping` |
| 어떤 포트가 열려 있고 어느 프로그램이 쓰는지 | `netstat -ano` |
| 같은 LAN 장비의 MAC 주소, ARP 스푸핑 의심 | `arp -a` |
| 특정 네트워크로 가는 경로를 영구히 추가 | `route -p add` |

## 핵심 정리

- `ipconfig /all`은 MAC·DHCP·DNS까지, `/release`·`/renew`는 DHCP 주소 반납·갱신, `/flushdns`는 DNS 캐시 비우기, `/displaydns`는 캐시 보기, `/registerdns`는 DNS 재등록이에요.
- `ping`은 기본 32바이트 4회예요. `-t` 계속, `-n` 횟수, `-l` 크기, `-a` 이름 표시예요.
- `tracert`는 TTL을 늘려 가며 ICMP 시간 초과 메시지로 경로를 찾고(최대 30홉), `pathping`은 구간별 손실률까지 계산해요.
- `nslookup` 대화형에서는 `set type=mx`로 레코드 종류를, `server`로 질의할 DNS 서버를 바꿔요.
- `netstat -ano`는 숫자 주소와 PID까지 보여 주고, `-r`은 라우팅 테이블, `-e`는 이더넷 통계, `-s`는 프로토콜별 통계예요.
- `arp -a` 보기, `-d` 삭제, `-s` 정적 추가예요.
- `route print`로 보고, `route -p add`로 영구 경로를 추가하며, `route delete`로 지워요.
- `nbtstat -a`는 이름, `-A`는 IP로 원격 NetBIOS 이름 테이블을 조회해요.
- PowerShell 대응: `Test-Connection`(ping), `Get-NetIPConfiguration`(ipconfig), `Resolve-DnsName`(nslookup), `Test-NetConnection`(포트·경로 확인)이에요.

## 스스로 확인하기

**1.** 웹 서버의 IP 주소를 바꾼 뒤에도 PC가 계속 예전 주소로 접속한다. PC에 저장된 DNS 캐시를 지우는 명령은?
① `ipconfig /release` ② `ipconfig /flushdns` ③ `ipconfig /displaydns` ④ `nbtstat -R`

> [!ANSWER]
> 정답: ②
> `/flushdns`는 DNS 확인자 캐시를 비워요. `/displaydns`는 캐시를 보여 주기만 하고, `nbtstat -R`은 NetBIOS 이름 캐시를 다시 읽어요.

**2.** 서버에서 어떤 프로세스가 TCP 8080 포트를 열고 있는지 확인하려 한다. 연결 목록을 숫자 형식과 PID까지 보여 주는 명령은?
① `netstat -r` ② `netstat -e` ③ `netstat -ano` ④ `netstat -s`

> [!ANSWER]
> 정답: ③
> `-a`는 모든 연결과 대기 포트, `-n`은 숫자 형식, `-o`는 PID를 보여 줘요. 이어서 `tasklist`로 PID에 해당하는 프로그램을 찾아요.

**3.** 10.30.0.0/16 네트워크로 가는 경로를 게이트웨이 192.168.10.254로 추가하되, 다시 시작한 뒤에도 남아 있게 하려면?
① `route add 10.30.0.0 mask 255.255.0.0 192.168.10.254`
② `route -p add 10.30.0.0 mask 255.255.0.0 192.168.10.254`
③ `route print 10.30.0.0 -p`
④ `arp -s 10.30.0.0 192.168.10.254`

> [!ANSWER]
> 정답: ②
> `-p` 옵션을 붙여 추가한 경로는 영구 경로로 저장되어 다시 시작해도 유지돼요. ①은 다시 시작하면 사라져요.

**4.** IP 주소 192.168.10.30인 컴퓨터의 NetBIOS 이름 테이블을 조회하는 명령은?
① `nbtstat -a 192.168.10.30` ② `nbtstat -A 192.168.10.30` ③ `nbtstat -n 192.168.10.30` ④ `nbtstat -c 192.168.10.30`

> [!ANSWER]
> 정답: ②
> IP 주소로 지정할 때는 대문자 `-A`, 컴퓨터 이름으로 지정할 때는 소문자 `-a`를 써요.

**5.** 게이트웨이까지 1000바이트 크기의 ping을 10번 보내려고 한다. 알맞은 명령은?
① `ping -t 10 -l 1000 192.168.10.1` ② `ping -n 1000 -l 10 192.168.10.1` ③ `ping -n 10 -l 1000 192.168.10.1` ④ `ping -a 10 -w 1000 192.168.10.1`

> [!ANSWER]
> 정답: ③
> `-n`은 보낼 횟수, `-l`은 데이터 크기(바이트)예요. `-t`는 멈출 때까지 계속 보내는 옵션이라 숫자를 받지 않아요.
