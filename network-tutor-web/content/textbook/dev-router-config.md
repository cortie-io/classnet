라우터와 스위치는 대부분 명령줄 인터페이스(CLI, Command Line Interface)로 설정해요. 이 단원에서는 **시스코 IOS 계열 예시**를 기준으로 CLI 모드를 오가는 법, 이름·비밀번호·인터페이스·정적 경로를 설정하는 법, 상태를 확인하는 show 명령, 설정을 저장하는 법을 차례로 익혀요. 시험은 "이 프롬프트는 어떤 모드인가", "이 명령은 무슨 일을 하는가"를 자주 묻기 때문에 실제 입력 순서대로 따라가 보는 것이 가장 좋아요.

> [!GOAL]
> - 프롬프트 모양만 보고 현재 CLI 모드를 구분하고, 모드 사이를 이동할 수 있다.
> - 호스트 이름·비밀번호·인터페이스 IP·정적 경로를 설정하는 명령을 쓸 수 있다.
> - 주요 show 명령이 보여 주는 정보와 설정 저장·삭제 명령을 구분할 수 있다.
> - 표준·확장 ACL과 비밀번호 복구의 기본 원리를 설명할 수 있다.

> [!NOTE]
> 이 단원의 명령은 모두 **시스코 IOS 계열 예시**예요. 다른 제조사 장비는 명령 이름이 다를 수 있지만, 모드를 나누고 설정을 저장하는 개념은 비슷해요.

## 장비에 접속하기

새 장비는 IP 주소가 없으므로 처음에는 **콘솔 포트**로 직접 연결해요. 콘솔 케이블(롤오버 케이블 또는 USB 콘솔 케이블)로 PC와 장비를 잇고, PC의 터미널 프로그램을 다음 값으로 맞춰요.

| 항목 | 값 |
|---|---|
| 속도 | 9600bps |
| 데이터 비트 | 8 |
| 패리티 | 없음 |
| 정지 비트 | 1 |
| 흐름 제어 | 없음 |

IP 주소를 설정한 뒤에는 네트워크를 통해 **텔넷**(Telnet)이나 **SSH**로 원격 접속할 수 있어요. 원격 접속은 장비의 가상 터미널 라인인 **VTY**로 들어와요.

## CLI 모드

### 모드와 프롬프트

| 모드 | 프롬프트 | 들어가는 명령 | 할 수 있는 일 |
|---|---|---|---|
| 사용자 EXEC | `Router>` | 접속 직후 | ping, 일부 show 등 간단한 확인 |
| 특권 EXEC | `Router#` | `enable` | 모든 show, 설정 저장, 재시작, 디버그 |
| 전역 설정 | `Router(config)#` | `configure terminal` | 장비 전체에 적용되는 설정 |
| 인터페이스 설정 | `Router(config-if)#` | `interface 이름` | 포트별 IP 주소, 활성화 |
| 라인 설정 | `Router(config-line)#` | `line console 0`, `line vty 0 4` | 접속 비밀번호, 접속 방식 |
| 라우팅 설정 | `Router(config-router)#` | `router ospf 1` 등 | 동적 라우팅 프로토콜 설정 |

설정 모드들은 **특권 EXEC 모드 아래에 층층이** 있다고 생각하면 돼요. 사용자 EXEC → 특권 EXEC → 전역 설정 → 세부 설정 순으로 깊어져요.

### 모드 이동 명령

| 명령 | 동작 |
|---|---|
| `enable` | 사용자 EXEC → 특권 EXEC |
| `disable` | 특권 EXEC → 사용자 EXEC |
| `configure terminal` | 특권 EXEC → 전역 설정 |
| `exit` | 한 단계 위로(전역 설정에서는 특권 EXEC로, EXEC 모드에서는 접속 종료) |
| `end` 또는 Ctrl+Z | 어느 설정 모드에서든 **바로 특권 EXEC로** |

```text
Router> enable
Router# configure terminal
Router(config)# interface gigabitEthernet 0/0
Router(config-if)# exit
Router(config)# end
Router#
```

### 편리한 기능

- `?`를 치면 지금 쓸 수 있는 명령 목록이 나와요. `sh?`처럼 글자 뒤에 붙이면 그 글자로 시작하는 명령을 보여 줘요.
- Tab 키로 명령을 자동 완성해요.
- 다른 명령과 겹치지 않으면 줄여 써도 돼요. 예: `conf t`, `sh ip int br`, `int g0/0`.
- 명령 앞에 `no`를 붙이면 그 설정을 취소해요. 예: `no shutdown`, `no ip route ...`
- 설정 모드에서 show 명령을 실행하려면 앞에 `do`를 붙여요. 예: `do show ip interface brief`

## 기본 설정

### 호스트 이름과 특권 모드 비밀번호

```text
Router(config)# hostname R1
R1(config)# enable secret Cl4ss-En!
```

`hostname`을 입력하는 즉시 프롬프트가 바뀌어요. 특권 EXEC로 들어갈 때 묻는 비밀번호는 두 가지 방법으로 정할 수 있어요.

| 명령 | 저장 방식 | 비고 |
|---|---|---|
| `enable password` | 설정 파일에 평문으로 저장 | 옛 방식, 권장하지 않음 |
| `enable secret` | 해시(일방향 암호화)로 저장 | 둘 다 설정되면 **secret이 우선** |

### 콘솔·VTY 비밀번호

```text
R1(config)# line console 0
R1(config-line)# password Con-Pass1
R1(config-line)# login
R1(config-line)# exit
R1(config)# line vty 0 4
R1(config-line)# password Vty-Pass1
R1(config-line)# login
R1(config-line)# exit
```

- `password`는 비밀번호를 정하고, **`login`이 있어야 실제로 비밀번호를 물어요.** 둘은 세트예요.
- `line vty 0 4`는 VTY 0번부터 4번까지, 즉 **원격 접속 5개**를 한꺼번에 설정한다는 뜻이에요.
- VTY에 비밀번호가 없으면 텔넷 접속 자체가 거부돼요.

### 비밀번호 암호화와 배너

```text
R1(config)# service password-encryption
R1(config)# banner motd #Authorized access only#
R1(config)# no ip domain-lookup
```

- `service password-encryption`은 설정 파일에 평문으로 보이는 콘솔·VTY 비밀번호 등을 **간단한 방식(타입 7)으로 가려 줘요.** 어깨 너머로 보는 것을 막는 정도이고 쉽게 풀리므로, 강한 보호가 필요한 곳에는 `secret` 계열 명령을 써요.
- `banner motd`는 접속할 때 보여 줄 안내문이에요. 앞뒤의 같은 문자(여기서는 `#`)가 문구의 시작과 끝을 표시해요.
- `no ip domain-lookup`은 명령을 잘못 입력했을 때 그것을 도메인 이름으로 착각해 한참 동안 찾는 일을 막아요.

> [!NOTE]
> 텔넷은 비밀번호까지 평문으로 오가므로 실무에서는 SSH를 써요. SSH를 쓰려면 도메인 이름 설정, RSA 키 생성, 로컬 사용자 계정이 필요해요. 아래 전체 예시에 들어 있어요.

## 인터페이스 설정

```text
R1(config)# interface gigabitEthernet 0/0
R1(config-if)# description LAN-Sales
R1(config-if)# ip address 192.168.10.1 255.255.255.0
R1(config-if)# no shutdown
```

- `ip address` 뒤에는 IP 주소와 **서브넷 마스크**를 써요(접두사 길이 `/24` 형식이 아님).
- 라우터 인터페이스는 기본적으로 꺼져 있어요(administratively down). 반드시 `no shutdown`을 입력해야 켜져요. 반대로 스위치 포트는 기본적으로 켜져 있어요.
- `description`은 메모일 뿐 동작에는 영향이 없지만, 관리할 때 큰 도움이 돼요.
- 시리얼 링크의 DCE 쪽에서는 `clock rate 64000`처럼 클럭 속도를 지정해요.

L2 스위치는 포트에 IP를 주지 않고, 원격 관리를 위해 **VLAN 인터페이스**에 관리용 IP와 기본 게이트웨이를 설정해요.

```text
Switch(config)# interface vlan 1
Switch(config-if)# ip address 192.168.10.2 255.255.255.0
Switch(config-if)# no shutdown
Switch(config-if)# exit
Switch(config)# ip default-gateway 192.168.10.1
```

## 정적 경로와 기본 경로

정적 경로의 문법은 다음과 같아요.

```text
ip route 목적지-네트워크 서브넷-마스크 다음-홉-IP(또는 출구 인터페이스)
```

```text
R1(config)# ip route 192.168.20.0 255.255.255.0 10.0.12.2
R1(config)# ip route 0.0.0.0 0.0.0.0 203.0.113.1
```

- 첫 줄: "192.168.20.0/24로 가는 패킷은 10.0.12.2에게 넘겨라."
- 둘째 줄: 목적지와 마스크가 모두 0인 **기본 경로**(Default Route)예요. 라우팅 테이블에 맞는 경로가 없는 모든 패킷을 203.0.113.1로 보내요.
- 정적 경로의 기본 관리 거리는 1이에요. 개념은 [라우팅의 원리](/textbook/tcpip-routing-basics) 단원을 참고하세요.

> [!WARNING]
> Windows의 `route add` 명령과 헷갈리지 마세요. 시스코 라우터에서는 전역 설정 모드에서 `ip route`를 써요.

## show 명령으로 확인하기

| 명령 | 보여 주는 것 |
|---|---|
| `show running-config` | RAM에 있는 **현재 동작 중인 설정** |
| `show startup-config` | NVRAM에 **저장된 설정** |
| `show ip interface brief` | 인터페이스별 IP 주소와 상태를 한 줄씩 요약 |
| `show ip route` | 라우팅 테이블 |
| `show interfaces` | 인터페이스 상세 정보(MAC, 대역폭, 오류·충돌 횟수 등) |
| `show version` | IOS 버전, 가동 시간, 모델, 메모리 크기, 설정 레지스터 값 |
| `show vlan brief` | (스위치) VLAN 목록과 소속 포트 |
| `show mac address-table` | (스위치) MAC 주소 테이블 |
| `show cdp neighbors` | 직접 연결된 시스코 장비 정보 |

`show ip interface brief`의 Status·Protocol 열을 읽는 법이 중요해요.

| Status / Protocol | 뜻과 의심할 곳 |
|---|---|
| up / up | 정상 |
| administratively down / down | `shutdown` 상태 → `no shutdown` 필요 |
| down / down | 1계층 문제(케이블 빠짐, 상대 장비 꺼짐) |
| up / down | 2계층 문제(캡슐화 불일치, 클럭 미설정 등) |

`show ip route`에서는 경로 앞의 코드로 출처를 알 수 있어요. `C`는 직접 연결된 네트워크, `L`은 인터페이스 자신의 주소, `S`는 정적 경로, `S*`는 기본 경로로 쓰이는 정적 경로예요.

## 설정 저장과 삭제

| 명령 | 동작 |
|---|---|
| `copy running-config startup-config` | 현재 설정을 NVRAM에 저장 |
| `write memory` | 위와 같은 효과의 옛 명령(줄여서 `wr`) |
| `erase startup-config` | NVRAM의 저장된 설정 삭제 |
| `reload` | 장비 재시작 |
| `copy running-config tftp` | 설정을 TFTP 서버에 백업 |

- 설정 명령은 입력 즉시 running-config에 반영되지만, **저장하지 않고 재시작하면 사라져요.**
- 공장 초기 상태로 만들려면 `erase startup-config` 후 `reload`해요. 저장된 설정이 없으므로 초기 설정 모드로 부팅돼요.
- 반대 방향인 `copy startup-config running-config`는 덮어쓰기가 아니라 **현재 설정에 합치기**(병합)로 동작해요.

> [!EXAM]
> 시험에는 "현재 설정을 다음 부팅 때도 쓰도록 저장하는 명령"으로 `copy running-config startup-config`를 고르는 문제가 자주 나와요. 방향(running → startup)을 거꾸로 쓴 보기가 함정이에요.

## 전체 설정 예시

지점 라우터 R1을 처음부터 설정하는 예예요. LAN(192.168.10.0/24), 이웃 라우터 R2와의 연결(10.0.12.0/30), 인터넷 사업자 연결(203.0.113.0/30)이 있고, R2 뒤의 192.168.20.0/24로 가는 정적 경로와 기본 경로를 넣어요.

```text
Router> enable
Router# configure terminal
Router(config)# hostname R1
R1(config)# no ip domain-lookup
R1(config)# enable secret Cl4ss-En!
R1(config)# service password-encryption
R1(config)# banner motd #Authorized access only#
R1(config)# line console 0
R1(config-line)# password Con-Pass1
R1(config-line)# login
R1(config-line)# exec-timeout 5 0
R1(config-line)# exit
R1(config)# ip domain-name example.com
R1(config)# username admin secret Adm-Pass1
R1(config)# crypto key generate rsa modulus 2048
R1(config)# line vty 0 4
R1(config-line)# login local
R1(config-line)# transport input ssh
R1(config-line)# exit
R1(config)# interface gigabitEthernet 0/0
R1(config-if)# description LAN-Sales
R1(config-if)# ip address 192.168.10.1 255.255.255.0
R1(config-if)# no shutdown
R1(config-if)# exit
R1(config)# interface gigabitEthernet 0/1
R1(config-if)# description Link-to-R2
R1(config-if)# ip address 10.0.12.1 255.255.255.252
R1(config-if)# no shutdown
R1(config-if)# exit
R1(config)# interface gigabitEthernet 0/2
R1(config-if)# description Link-to-ISP
R1(config-if)# ip address 203.0.113.2 255.255.255.252
R1(config-if)# no shutdown
R1(config-if)# exit
R1(config)# ip route 192.168.20.0 255.255.255.0 10.0.12.2
R1(config)# ip route 0.0.0.0 0.0.0.0 203.0.113.1
R1(config)# end
R1# copy running-config startup-config
```

- `exec-timeout 5 0`은 5분 동안 입력이 없으면 콘솔 접속을 끊어요.
- `login local`은 라인 비밀번호 대신 `username`으로 만든 계정으로 로그인하게 해요.
- 마지막 저장 명령을 입력하면 저장할 파일 이름을 물어요. Enter를 누르면 기본값(startup-config)으로 저장돼요.

## ACL 맛보기

**ACL**(Access Control List, 접근 제어 목록)은 조건에 맞는 패킷을 허용(permit)하거나 거부(deny)하는 규칙 목록이에요.

| 구분 | 표준 ACL | 확장 ACL |
|---|---|---|
| 번호 | 1~99(확장 범위 1300~1999) | 100~199(확장 범위 2000~2699) |
| 검사 항목 | 출발지 IP만 | 출발지·목적지 IP, 프로토콜, 포트 번호 |
| 권장 위치 | 목적지에 가까운 곳 | 출발지에 가까운 곳 |

```text
R1(config)# access-list 110 deny tcp 192.168.10.0 0.0.0.255 host 192.168.20.10 eq 23
R1(config)# access-list 110 permit ip any any
R1(config)# interface gigabitEthernet 0/0
R1(config-if)# ip access-group 110 in
```

- 규칙은 **위에서부터 차례로** 비교하고, 처음 맞는 규칙 하나만 적용해요.
- 목록 끝에는 보이지 않는 **암묵적 거부**(Implicit Deny), 즉 "나머지는 모두 거부" 규칙이 있어요. 그래서 permit이 하나도 없는 ACL을 걸면 모든 트래픽이 막혀요.
- 주소 뒤의 `0.0.0.255`는 **와일드카드 마스크**예요. 0인 비트는 반드시 일치, 1인 비트는 무시해요. 서브넷 마스크를 뒤집은 모양이라고 생각하면 쉬워요.
- 만든 ACL은 `ip access-group 번호 in|out`으로 인터페이스에 적용해야 동작해요.

## 비밀번호 복구의 원리

특권 비밀번호를 잊었을 때는 **설정 레지스터(Configuration Register)** 값을 바꿔 NVRAM의 설정을 건너뛰고 부팅해요.

1. 콘솔로 연결하고 전원을 껐다 켠 직후 Break 신호를 보내 **ROMMON 모드**로 들어가요.
2. `confreg 0x2142`로 "부팅할 때 NVRAM 설정을 무시"하도록 바꾸고 `reset`으로 재시작해요.
3. 비밀번호 없이 특권 모드로 들어가 `copy startup-config running-config`로 원래 설정을 불러와요.
4. 새 비밀번호를 설정하고, `config-register 0x2102`로 **정상 부팅 값**을 되돌린 뒤 저장해요.

> [!TIP]
> 0x210**2**는 평소대로, 0x21**4**2는 NVRAM 설정을 무시하고 부팅해요. 가운데 4가 "설정을 건너뛴다"는 표시라고 기억하세요.

## 핵심 정리

- 프롬프트: `>` 사용자 EXEC, `#` 특권 EXEC, `(config)#` 전역 설정, `(config-if)#` 인터페이스, `(config-line)#` 라인 설정.
- `enable` → 특권, `configure terminal` → 전역 설정, `exit` → 한 단계 위, `end`·Ctrl+Z → 바로 특권 EXEC.
- `enable secret`은 해시로 저장되고 `enable password`보다 우선해요. `service password-encryption`은 평문 비밀번호를 약하게 가려 줘요.
- 콘솔·VTY는 `password`와 `login`을 함께 써야 비밀번호를 물어요. `line vty 0 4`는 원격 접속 5개예요.
- 라우터 인터페이스는 `ip address 주소 마스크`로 주소를 주고 `no shutdown`으로 **꼭 켜야** 해요.
- 정적 경로는 `ip route 네트워크 마스크 다음홉`, 기본 경로는 `ip route 0.0.0.0 0.0.0.0 다음홉`이에요.
- 저장은 `copy running-config startup-config`(또는 `write memory`), 초기화는 `erase startup-config` 후 `reload`예요.
- 표준 ACL 1~99(출발지만), 확장 ACL 100~199(출발지·목적지·프로토콜·포트), 끝에는 암묵적 거부가 있어요.
- 비밀번호 복구는 설정 레지스터 0x2142로 부팅한 뒤 0x2102로 되돌려요.

## 스스로 확인하기

**1.** 프롬프트가 `R1(config-line)#`일 때 현재 모드는?
① 특권 EXEC 모드 ② 전역 설정 모드 ③ 인터페이스 설정 모드 ④ 라인 설정 모드

> [!ANSWER]
> 정답: ④
> `line console 0`이나 `line vty 0 4`로 들어가는 라인 설정 모드예요. 콘솔·원격 접속 비밀번호를 이곳에서 설정해요.

**2.** 인터페이스 설정 모드에 있을 때 한 번에 특권 EXEC 모드로 돌아가는 명령은?
① exit ② end ③ disable ④ logout

> [!ANSWER]
> 정답: ②
> `end`(또는 Ctrl+Z)는 어느 설정 모드에서든 바로 특권 EXEC로 돌아가요. `exit`은 한 단계씩만 올라가요.

**3.** 현재 동작 중인 설정을 재부팅 후에도 유지되도록 저장하는 명령은?
① copy startup-config running-config ② copy running-config startup-config ③ erase startup-config ④ show running-config

> [!ANSWER]
> 정답: ②
> RAM의 running-config를 NVRAM의 startup-config로 복사해야 재부팅해도 남아요. ①은 반대 방향으로 저장된 설정을 현재 설정에 합쳐요.

**4.** 시스코 IOS 계열 라우터에서 172.16.30.0/24 네트워크로 가는 패킷을 10.1.1.2로 보내는 정적 경로 설정으로 옳은 것은?
① ip route 172.16.30.0 255.255.255.0 10.1.1.2
② route add 172.16.30.0 mask 255.255.255.0 10.1.1.2
③ ip route 10.1.1.2 172.16.30.0 255.255.255.0
④ ip static 172.16.30.0/24 10.1.1.2

> [!ANSWER]
> 정답: ①
> 순서는 목적지 네트워크, 서브넷 마스크, 다음 홉이에요. ②는 Windows 명령 형식이에요.

**5.** `enable password`와 `enable secret`이 모두 설정된 라우터에서 특권 모드로 들어갈 때 쓰이는 비밀번호와 그 저장 방식으로 옳은 것은?
① enable password, 평문 저장 ② enable password, 해시 저장 ③ enable secret, 해시 저장 ④ 둘 중 먼저 설정한 것, 평문 저장

> [!ANSWER]
> 정답: ③
> 둘 다 있으면 enable secret이 우선하며, secret은 해시로 저장되어 설정 파일을 봐도 원래 비밀번호를 알 수 없어요.
