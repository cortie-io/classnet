Windows Server에 역할을 하나씩 더하면 회사 네트워크에 필요한 서비스를 직접 운영할 수 있어요. 이 단원에서는 DNS·DHCP 서버 구성, 웹·FTP 서버(IIS), 원격 데스크톱, 파일 서버와 업데이트 서버, Hyper-V 가상화, 그리고 서버 상태를 살피는 모니터링 도구까지 핵심을 정리해요. DNS와 DHCP가 동작하는 원리는 [DNS와 DHCP](/textbook/tcpip-dns-dhcp)에서 배웠으니, 여기서는 '서버에서 무엇을 어떻게 설정하는가'에 집중해요.

> [!GOAL]
> - DNS 서버의 영역 종류(정방향·역방향, 주·보조·스텁, AD 통합)를 구분할 수 있다
> - DHCP 서버의 범위·제외·예약·임대·옵션과 장애 조치를 설명할 수 있다
> - IIS 바인딩, 원격 데스크톱 서비스, WSUS, Hyper-V 가상 스위치와 검사점의 특징을 말할 수 있다
> - 이벤트 뷰어의 로그 종류와 성능 모니터·리소스 모니터·작업 관리자의 쓰임을 구분할 수 있다

## DNS 서버

### 정방향 조회 영역과 역방향 조회 영역

영역(Zone)은 DNS 서버 한 대가 책임지고 관리하는 이름 공간의 범위예요. DNS 관리자(`dnsmgmt.msc`)를 열면 영역이 두 갈래로 나뉘어 있어요.

- 정방향 조회 영역(Forward Lookup Zone): 이름으로 IP 주소를 찾아요. 예: `hanbit.example.com` 영역에서 `www` → 192.168.10.20
- 역방향 조회 영역(Reverse Lookup Zone): IP 주소로 이름을 찾아요. PTR 레코드를 담아요. IPv4는 `in-addr.arpa`, IPv6는 `ip6.arpa` 아래에 만들어요.

> [!TIP]
> 역방향 영역 이름은 네트워크 부분의 옥텟을 거꾸로 쓰고 `.in-addr.arpa`를 붙여요. 192.168.10.0/24 네트워크라면 `10.168.192.in-addr.arpa`예요.

### 영역의 종류

| 종류 | 담고 있는 데이터 | 특징 |
|---|---|---|
| 주 영역(Primary Zone) | 원본, 읽기·쓰기 가능 | 레코드를 직접 추가·수정하는 곳 |
| 보조 영역(Secondary Zone) | 주 영역의 읽기 전용 사본 | 영역 전송(Zone Transfer, TCP 53)으로 받아 옴. 전체 전송은 AXFR, 바뀐 부분만은 IXFR. 부하 분산과 장애 대비용 |
| 스텁 영역(Stub Zone) | 대상 영역의 SOA, NS 레코드와 그 이름 서버의 A 레코드만 | 그 영역을 책임지는 서버가 누구인지만 알고 있음 |
| AD 통합 영역(Active Directory-Integrated Zone) | AD 데이터베이스에 저장 | 도메인 컨트롤러에서만 가능. AD 복제로 동기화되어 어느 DC에서나 수정 가능(다중 마스터). 보안 동적 업데이트 지원 |

AD 통합은 주 영역이나 스텁 영역을 AD에 저장하는 방식이고, 보조 영역은 AD 통합으로 만들 수 없어요.

- 동적 업데이트(Dynamic Update): 클라이언트가 자기 A·PTR 레코드를 DNS 서버에 자동으로 등록해요. 인증된 컴퓨터만 등록할 수 있는 '보안 동적 업데이트'는 AD 통합 영역에서만 쓸 수 있어요.
- 전달자(Forwarder): 자기가 모르는 이름의 질의를 넘길 상위 DNS 서버예요. 특정 도메인만 지정한 서버로 넘기는 조건부 전달자(Conditional Forwarder)도 있어요.
- 루트 힌트(Root Hints): 전달자가 없을 때 루트 DNS 서버부터 차례로 물어보기 위한 목록이에요.
- 노화 및 정리(Aging and Scavenging): 오랫동안 갱신되지 않은 동적 레코드를 자동으로 지워요.

### 주요 레코드

| 레코드 | 의미 |
|---|---|
| A / AAAA | 이름 → IPv4 / IPv6 주소 |
| CNAME | 별칭(다른 이름을 가리킴) |
| MX | 메일 서버(우선순위 숫자가 작을수록 먼저 사용) |
| NS | 영역을 책임지는 이름 서버 |
| SOA | 영역의 기본 정보(주 서버, 일련 번호, 새로 고침 간격 등) |
| PTR | IP 주소 → 이름(역방향) |
| SRV | 특정 서비스를 제공하는 서버의 위치(AD에서 DC 찾기) |
| TXT | 자유 형식 텍스트(메일 발신 서버 확인 정보 등) |

```powershell
# AD 통합 정방향 영역과 A 레코드 만들기
Add-DnsServerPrimaryZone -Name "hanbit.example.com" -ReplicationScope "Domain"
Add-DnsServerResourceRecordA -ZoneName "hanbit.example.com" -Name "www" -IPv4Address 192.168.10.20

# 192.168.10.0/24에 대한 역방향 영역 만들기
Add-DnsServerPrimaryZone -NetworkId "192.168.10.0/24" -ReplicationScope "Domain"
```

## DHCP 서버

### 핵심 용어

| 용어 | 뜻 | 예 |
|---|---|---|
| 범위(Scope) | 한 서브넷에서 나눠 줄 주소 구간과 서브넷 마스크 | 192.168.10.100 ~ 192.168.10.200, 255.255.255.0 |
| 제외 범위(Exclusion Range) | 범위 안에 있지만 나눠 주지 않을 주소 | 서버·프린터가 고정으로 쓰는 192.168.10.100 ~ 192.168.10.110 |
| 예약(Reservation) | 특정 MAC 주소에 항상 같은 IP를 줌 | 복합기 MAC → 192.168.10.150 |
| 임대 기간(Lease Duration) | 주소를 빌려주는 기간 | Windows DHCP 서버 기본값 8일 |
| 옵션(Option) | IP 주소 말고 함께 알려 주는 설정 | 기본 게이트웨이, DNS 서버 |
| 슈퍼 범위(Superscope) | 여러 범위를 묶어 한 물리 네트워크에서 사용 | 주소가 모자라 대역을 추가할 때 |

> [!WARNING]
> 제외와 예약을 헷갈리기 쉬워요. 제외는 "이 주소는 아무에게도 나눠 주지 마", 예약은 "이 주소는 이 MAC 주소를 가진 장치에게만 줘"예요. 예약은 DHCP로 받으면서도 주소가 바뀌지 않게 하는 방법이에요.

클라이언트는 임대 기간의 50%가 지나면 같은 서버에 갱신을 요청하고, 87.5%가 지나도 갱신하지 못하면 아무 DHCP 서버에나 갱신을 요청해요.

### DHCP 옵션

| 번호 | 이름 | 내용 |
|---|---|---|
| 003 | 라우터(Router) | 기본 게이트웨이 주소 |
| 006 | DNS 서버(DNS Servers) | DNS 서버 주소 |
| 015 | DNS 도메인 이름(DNS Domain Name) | DNS 접미사 |
| 044 | WINS/NBNS 서버 | WINS 서버 주소 |
| 066 / 067 | 부트 서버 호스트 이름 / 부트 파일 이름 | 네트워크 부팅(PXE)용 |

옵션은 서버 옵션(모든 범위), 범위 옵션(그 범위만), 예약 옵션(그 장치만)으로 설정할 수 있어요. 겹치면 적용 대상이 좁은 쪽이 우선해요. 즉, 예약 옵션 > 범위 옵션 > 서버 옵션이에요.

### 권한 부여와 릴레이

- 권한 부여(Authorize): 도메인 환경의 Windows DHCP 서버는 AD에서 권한을 부여받아야 주소를 나눠 줘요. 아무나 DHCP 서버를 세워 엉뚱한 주소를 뿌리는 것(불법 DHCP 서버)을 막기 위해서예요.
- DHCP 릴레이 에이전트(Relay Agent): DHCP 요청은 브로드캐스트라 라우터를 넘지 못해요. 다른 서브넷의 클라이언트에게 주소를 주려면 라우터나 서버에 릴레이 에이전트를 설정해 요청을 DHCP 서버로 전달해야 해요.
- 포트: 서버 UDP 67, 클라이언트 UDP 68

### DHCP 장애 조치

DHCP 장애 조치(DHCP Failover)는 Windows Server 2012부터 생긴 기능으로, DHCP 서버 두 대가 같은 범위의 임대 정보를 서로 복제해서 한 대가 멈춰도 주소 할당이 계속되게 해요. IPv4 범위에서 서버 두 대까지 짝을 지을 수 있어요.

| 모드 | 동작 |
|---|---|
| 부하 분산(Load Balance) | 두 서버가 요청을 나눠 처리(기본 50:50). 기본 모드 |
| 핫 스탠바이(Hot Standby) | 평소에는 한 대(활성)가 처리하고 다른 한 대(대기)는 기다림. 대기 서버는 주소 일부(기본 5%)를 예비로 확보 |

장애 조치가 나오기 전에는 한 범위를 두 서버에 80:20으로 나눠 구성하는 분할 범위(80/20 규칙)를 썼어요.

```powershell
Add-DhcpServerv4Scope -Name "본사-1층" -StartRange 192.168.10.100 -EndRange 192.168.10.200 -SubnetMask 255.255.255.0 -LeaseDuration 8.00:00:00
Add-DhcpServerv4ExclusionRange -ScopeId 192.168.10.0 -StartRange 192.168.10.100 -EndRange 192.168.10.110
Add-DhcpServerv4Reservation -ScopeId 192.168.10.0 -IPAddress 192.168.10.150 -ClientId "00-1A-2B-3C-4D-5E" -Name "복합기"
Set-DhcpServerv4OptionValue -ScopeId 192.168.10.0 -Router 192.168.10.1 -DnsServer 192.168.10.10
Add-DhcpServerInDC -DnsName "dhcp01.hanbit.example.com" -IPAddress 192.168.10.11
```

위에서부터 범위 만들기, 제외 범위 지정, 예약, 범위 옵션(003·006) 설정, AD 권한 부여예요.

## IIS: 웹 서버와 FTP 서버

### 사이트와 바인딩

IIS(Internet Information Services)는 Windows Server의 웹 서버 역할이에요. Windows Server 2016, 2019, 2022에는 IIS 10.0이 들어 있어요. 설치하면 'Default Web Site'가 만들어지고, 웹 문서의 기본 폴더는 `C:\inetpub\wwwroot`예요. 관리는 IIS 관리자(`inetmgr`)로 해요.

바인딩(Binding)은 사이트가 어떤 요청을 받을지 정하는 조합이에요. 프로토콜(http/https) + IP 주소 + 포트 + 호스트 이름으로 이루어져요. IP 주소 하나, 포트 80 하나로 여러 사이트를 운영하려면 호스트 이름(호스트 헤더)으로 구분해요.

| 사이트 | 프로토콜 | IP 주소 | 포트 | 호스트 이름 |
|---|---|---|---|---|
| 회사 홈페이지 | http | 모두 할당되지 않음 | 80 | www.example.com |
| 쇼핑몰 | http | 모두 할당되지 않음 | 80 | shop.example.com |
| 회사 홈페이지(보안) | https | 모두 할당되지 않음 | 443 | www.example.com(서버 인증서 필요) |

- 기본 문서(Default Document): 주소에 파일 이름이 없을 때 보여 줄 파일(index.html, default.htm 등)
- 가상 디렉터리(Virtual Directory): 실제로는 다른 위치에 있는 폴더를 사이트의 하위 경로처럼 보이게 함
- 응용 프로그램 풀(Application Pool): 웹 애플리케이션을 분리된 작업자 프로세스에서 실행해서, 한 사이트의 문제가 다른 사이트로 번지지 않게 함
- 인증 방식: 익명 인증, 기본 인증(암호가 Base64로만 인코딩되므로 HTTPS와 함께 써야 함), Windows 인증
- 접속 기록(로그): `C:\inetpub\logs\LogFiles`

### FTP 서버

IIS의 역할 서비스 'FTP 서버'를 설치하면 IIS 관리자에서 FTP 사이트를 만들 수 있어요. 제어 연결은 TCP 21, 데이터 연결은 액티브 모드에서 TCP 20, 패시브 모드에서는 서버가 정한 임의 포트를 써요. FTP 사이트에서는 SSL을 적용한 FTPS와, 사용자마다 자기 폴더만 보이게 하는 FTP 사용자 격리(User Isolation)를 설정할 수 있어요.

```powershell
Install-WindowsFeature -Name Web-Server, Web-Ftp-Server -IncludeManagementTools
```

## 원격 데스크톱

### 관리용 원격 데스크톱

RDP(Remote Desktop Protocol)는 서버의 화면을 네트워크로 받아 조작하는 프로토콜이에요. 기본 포트는 TCP 3389이고, 최신 버전은 UDP 3389도 함께 써요. 클라이언트 프로그램은 '원격 데스크톱 연결'(`mstsc`)이에요.

- 서버 관리자 → 로컬 서버 → 원격 데스크톱, 또는 시스템 속성(`sysdm.cpl`) → [원격] 탭에서 켜요.
- 관리 목적의 원격 데스크톱은 추가 라이선스 없이 동시에 2세션까지 쓸 수 있어요.
- NLA(Network Level Authentication, 네트워크 수준 인증)를 켜 두면 세션 화면을 만들기 전에 먼저 인증해서, 인증 안 된 접속이 서버 자원을 쓰지 못하게 막아요.
- 관리자가 아닌 사용자가 접속하려면 Remote Desktop Users 그룹에 넣어야 해요.

### 원격 데스크톱 서비스(RDS)

여러 사용자가 서버에서 바탕 화면이나 프로그램을 동시에 쓰게 하려면 원격 데스크톱 서비스(RDS, Remote Desktop Services) 역할을 설치해요.

| 역할 서비스 | 하는 일 |
|---|---|
| RD 세션 호스트(RD Session Host) | 사용자 세션과 프로그램(RemoteApp)을 실제로 실행 |
| RD 연결 브로커(RD Connection Broker) | 세션 호스트 여러 대에 사용자를 나눠 주고, 끊긴 세션에 다시 연결 |
| RD 웹 액세스(RD Web Access) | 웹 페이지에서 쓸 수 있는 프로그램·바탕 화면 목록 제공 |
| RD 게이트웨이(RD Gateway) | 인터넷의 사용자가 HTTPS(TCP 443)로 내부 서버에 RDP 접속하도록 중계 |
| RD 라이선싱(RD Licensing) | RDS CAL 발급과 관리 |
| RD 가상화 호스트(RD Virtualization Host) | Hyper-V 가상 머신으로 개인 바탕 화면(VDI) 제공 |

RD 세션 호스트를 쓰려면 사용자나 장치마다 RDS CAL이 필요하고, 라이선스 서버를 설정하기 전까지 120일의 유예 기간이 있어요.

## 파일 서버와 DFS

파일 서버는 '파일 및 저장소 서비스' 역할의 역할 서비스로, SMB(TCP 445)로 공유 폴더를 제공해요. 권한 설정은 [Windows 파일 시스템과 권한](/textbook/nos-windows-file-permissions)에서 배웠어요. 최신 버전은 보안 문제 때문에 오래된 SMB 1.0을 기본으로 설치하지 않아요.

DFS(Distributed File System, 분산 파일 시스템)는 여러 서버에 흩어진 공유 폴더를 하나처럼 쓰게 해 줘요.

- DFS 네임스페이스(DFS Namespaces): 여러 서버의 공유 폴더를 하나의 가상 경로로 묶어요. 예를 들어 사용자는 `\\hanbit.example.com\Public\영업`으로 접속하지만 실제 위치는 `\\FS01\Sales`예요. 서버를 바꿔도 사용자가 쓰는 경로는 그대로예요.
- DFS 복제(DFS Replication): 여러 서버의 폴더 내용을 서로 복제해요. 바뀐 부분만 압축해서 보내는 원격 차등 압축(RDC, Remote Differential Compression)을 써서 WAN 대역폭을 아껴요.

## WSUS

WSUS(Windows Server Update Services)는 Microsoft 업데이트를 사내 서버가 한 번만 내려받아, 관리자가 승인한 것만 내부 PC와 서버에 배포하는 역할이에요.

- 장점: 인터넷 대역폭 절약, 테스트한 뒤 승인해서 배포, 컴퓨터별 설치 현황 보고
- 클라이언트 연결: 그룹 정책의 '인트라넷 Microsoft 업데이트 서비스 위치 지정'에 WSUS 서버 주소를 넣어요. 기본 포트는 HTTP 8530, HTTPS 8531이에요.
- 컴퓨터 그룹(예: 테스트 그룹, 전체 그룹)을 나눠 단계적으로 승인하고, 본사(상위 서버)와 지사(하위 서버)로 계층을 만들 수 있어요.

> [!NOTE]
> Microsoft는 WSUS에 더 이상 새 기능을 추가하지 않겠다고 발표했어요. 기존 기능은 계속 제공되므로 시험 범위의 개념은 그대로 알아 두면 돼요.

## Hyper-V

### 하이퍼바이저와 요구 사항

하이퍼바이저(Hypervisor)는 물리 서버 한 대에서 여러 가상 머신(VM, Virtual Machine)을 실행하게 하는 소프트웨어예요. Hyper-V는 하드웨어 바로 위에서 동작하는 1형(Type 1, 네이티브) 하이퍼바이저예요. 운영체제 위에 일반 프로그램처럼 설치하는 방식은 2형(Type 2, 호스티드)이라고 해요. VM을 실행하는 물리 컴퓨터를 호스트(Host), VM 안의 운영체제를 게스트(Guest)라고 불러요.

Hyper-V 역할을 설치하려면 64비트 CPU와 하드웨어 가상화 지원(Intel VT-x 또는 AMD-V), SLAT(Second Level Address Translation)가 필요하고, BIOS·UEFI 설정에서 가상화 기능이 켜져 있어야 해요. 관리는 Hyper-V 관리자(`virtmgmt.msc`)나 PowerShell로 해요.

### 가상 스위치

| 종류 | 통신할 수 있는 범위 | 쓰임 |
|---|---|---|
| 외부(External) | VM ↔ VM ↔ 호스트 ↔ 물리 네트워크 | VM을 실제 사내망·인터넷에 연결 |
| 내부(Internal) | VM ↔ VM ↔ 호스트 | 호스트와만 통신하는 테스트 망 |
| 개인(Private) | VM ↔ VM | 호스트와도 격리된 실습 망 |

외부 스위치는 물리 네트워크 어댑터에 연결되며, '관리 운영 체제가 이 네트워크 어댑터를 공유하도록 허용'을 켜 두면 호스트도 그 어댑터로 계속 통신할 수 있어요.

```powershell
New-VMSwitch -Name "외부망" -NetAdapterName "이더넷" -AllowManagementOS $true
New-VMSwitch -Name "실습망" -SwitchType Private
```

> [!TIP]
> 바깥까지 나가면 외부, 집 안(호스트)까지만 오가면 내부, 방 안(VM끼리)에서만 오가면 개인이라고 기억하세요.

### 검사점과 가상 디스크

검사점(Checkpoint)은 특정 시점의 VM 상태를 저장해 두었다가 문제가 생기면 그 시점으로 되돌리는 기능이에요. 예전에는 스냅숏(Snapshot)이라고 불렀어요.

| 종류 | 저장 방식 | 되돌렸을 때 |
|---|---|---|
| 표준 검사점(Standard) | 디스크와 메모리 상태까지 저장 | 실행 중이던 프로그램 상태 그대로 복원 |
| 프로덕션 검사점(Production) | 게스트 안의 백업 기술(Windows는 VSS)로 데이터를 일관되게 저장, 메모리 상태는 저장 안 함 | VM이 꺼진 상태로 복원. Windows Server 2016부터 기본값 |

```powershell
Checkpoint-VM -Name WEB01 -SnapshotName "업데이트 전"
```

> [!WARNING]
> 검사점은 백업이 아니에요. 검사점은 원래 가상 디스크와 같은 저장소에 차이 파일(.avhdx)로 쌓이기 때문에 저장소가 고장 나면 함께 사라지고, 오래 쌓아 두면 성능도 떨어져요. 백업은 Windows Server 백업 같은 별도 도구로 해야 해요.

- 가상 디스크 형식: VHD(최대 약 2TB), VHDX(최대 64TB, 전원 장애에 따른 손상 방지 기능 포함)
- 가상 디스크 종류: 고정 크기(Fixed), 동적 확장(Dynamically Expanding), 차이점(Differencing, 부모 디스크와 달라진 부분만 저장)
- VM 세대: 1세대(BIOS 기반, 오래된 운영체제 호환), 2세대(UEFI 기반, 보안 부팅 지원)
- 라이브 마이그레이션(Live Migration): 실행 중인 VM을 멈추지 않고 다른 호스트로 옮겨요.
- Hyper-V 복제본(Hyper-V Replica): VM의 사본을 다른 서버에 계속 복제해 두어 재해에 대비해요.

## 모니터링 도구

### 이벤트 뷰어

이벤트 뷰어(`eventvwr.msc`)는 운영체제와 프로그램이 남긴 기록(이벤트)을 보여 줘요. 장애가 났을 때 가장 먼저 열어 보는 도구예요.

| Windows 로그 | 기록하는 내용 |
|---|---|
| 응용 프로그램(Application) | 응용 프로그램이 남긴 이벤트(예: 데이터베이스 프로그램 오류) |
| 보안(Security) | 로그온 성공·실패, 파일 접근 같은 감사(Audit) 이벤트. 감사 정책을 켜야 기록됨 |
| 시스템(System) | 드라이버, Windows 서비스의 시작·중지 같은 운영체제 구성 요소의 이벤트 |
| 설치(Setup) | 업데이트와 역할·기능 설치 관련 이벤트 |
| 전달된 이벤트(Forwarded Events) | 다른 컴퓨터에서 구독으로 모아 온 이벤트 |

- 이벤트 수준: 위험(Critical), 오류(Error), 경고(Warning), 정보(Information), 자세한 정보(Verbose). 보안 로그에는 감사 성공과 감사 실패가 기록돼요.
- 대표 이벤트 ID: 4624는 로그온 성공, 4625는 로그온 실패예요. 4625가 짧은 시간에 쏟아지면 암호 대입 공격을 의심해요.
- '응용 프로그램 및 서비스 로그' 아래에는 DNS Server, Directory Service처럼 역할별 로그가 따로 있어요.
- 사용자 지정 보기로 필요한 이벤트만 걸러 보고, 특정 이벤트가 생기면 작업을 실행하도록 연결할 수도 있어요.

```powershell
Get-WinEvent -LogName System -MaxEvents 20
```

### 성능 모니터, 리소스 모니터, 작업 관리자

| 도구 | 실행 | 쓰임 |
|---|---|---|
| 작업 관리자(Task Manager) | `taskmgr`, Ctrl+Shift+Esc | CPU·메모리 사용량과 프로세스를 빠르게 확인, 응답 없는 프로그램 종료 |
| 리소스 모니터(Resource Monitor) | `resmon` | 프로세스별 CPU·메모리·디스크·네트워크 사용을 실시간으로 자세히. 어느 프로세스가 어떤 포트로 통신하는지 확인 |
| 성능 모니터(Performance Monitor) | `perfmon` | 성능 카운터를 그래프로 보기. 데이터 수집기 집합(Data Collector Set)으로 오랜 기간 기록하고 보고서 작성 |
| 안정성 모니터(Reliability Monitor) | `perfmon /rel` | 날짜별 안정성 지수와 프로그램 충돌·업데이트 이력 |

성능 모니터는 평소 상태를 기록해 둔 기준선(Baseline)과 지금 상태를 비교할 때 특히 유용해요. 자주 보는 카운터는 다음과 같아요.

| 카운터 | 이런 값이 계속되면 |
|---|---|
| Processor\% Processor Time | 계속 높으면 CPU 부족 |
| Memory\Available MBytes | 계속 낮으면 메모리 부족 |
| Memory\Pages/sec | 계속 높으면 페이징이 지나침(메모리 부족 신호) |
| PhysicalDisk\Avg. Disk Queue Length | 계속 길면 디스크 병목 |
| Network Interface\Bytes Total/sec | 링크 속도에 가까우면 네트워크 병목 |

> [!EXAM]
> "실시간으로 프로세스별 네트워크 사용과 포트를 확인하는 도구"는 리소스 모니터, "장기간 성능 데이터를 수집해 보고서를 만드는 도구"는 성능 모니터, "로그온 실패 기록을 확인할 로그"는 이벤트 뷰어의 보안 로그예요.

## 핵심 정리

- 정방향 영역은 이름 → IP, 역방향 영역은 IP → 이름(PTR, `in-addr.arpa`)이에요.
- 주 영역은 읽기·쓰기 원본, 보조 영역은 영역 전송으로 받은 읽기 전용 사본, 스텁 영역은 SOA·NS·글루 A 레코드만 가져요. AD 통합 영역은 DC에서만 가능하고 보안 동적 업데이트를 지원해요.
- DHCP의 제외는 '아무에게도 안 줌', 예약은 'MAC 주소에 고정 IP'예요. Windows 기본 임대 기간은 8일이에요.
- DHCP 옵션 003은 기본 게이트웨이, 006은 DNS 서버, 015는 DNS 도메인 이름이에요. 도메인 환경에서는 AD 권한 부여가 필요해요.
- DHCP 장애 조치는 부하 분산(기본 50:50)과 핫 스탠바이 모드가 있어요.
- IIS 바인딩은 프로토콜 + IP + 포트 + 호스트 이름이고, 호스트 이름으로 한 IP에서 여러 사이트를 운영해요.
- RDP는 TCP 3389, 관리용은 동시 2세션까지예요. RD 세션 호스트는 RDS CAL이 필요하고, RD 게이트웨이는 HTTPS 443으로 중계해요.
- Hyper-V 가상 스위치: 외부(물리망까지), 내부(호스트까지), 개인(VM끼리만). 검사점은 백업이 아니에요.
- 이벤트 뷰어의 응용 프로그램·보안·시스템 로그를 구분하고, 실시간 상세는 리소스 모니터, 장기 기록은 성능 모니터를 써요.

## 스스로 확인하기

**1.** 192.168.10.0/24 네트워크의 PTR 레코드를 담을 역방향 조회 영역의 이름으로 알맞은 것은?
① 192.168.10.in-addr.arpa ② 10.168.192.in-addr.arpa ③ 0.10.168.192.ip6.arpa ④ 192.168.10.0.arpa

> [!ANSWER]
> 정답: ②
> IPv4 역방향 영역은 네트워크 부분의 옥텟을 거꾸로 쓰고 `in-addr.arpa`를 붙여요.

**2.** 사무실 복합기가 DHCP로 주소를 받되, 항상 192.168.10.150을 받도록 하려면 DHCP 서버에서 무엇을 설정해야 하는가?
① 제외 범위 ② 슈퍼 범위 ③ 예약 ④ 서버 옵션 006

> [!ANSWER]
> 정답: ③
> 예약은 특정 MAC 주소에 항상 같은 IP 주소를 주는 설정이에요. 제외 범위는 그 주소를 아무에게도 주지 않아요.

**3.** Hyper-V에서 가상 머신끼리만 통신하고 호스트와 물리 네트워크로부터는 완전히 격리된 실습 망을 만들려고 한다. 알맞은 가상 스위치는?
① 외부 ② 내부 ③ 개인 ④ 브리지

> [!ANSWER]
> 정답: ③
> 개인 가상 스위치는 같은 스위치에 연결된 VM끼리만 통신할 수 있어요. 내부 스위치는 호스트와도 통신해요.

**4.** 누군가 서버에 계속 잘못된 암호로 로그온을 시도한 흔적을 찾으려 한다. 이벤트 뷰어에서 확인할 로그는?
① 응용 프로그램 ② 보안 ③ 시스템 ④ 설치

> [!ANSWER]
> 정답: ②
> 로그온 성공·실패 같은 감사 이벤트는 보안 로그에 기록돼요. 로그온 실패는 이벤트 ID 4625예요.

**5.** DNS 영역 종류 중 다른 영역의 SOA, NS 레코드와 그 이름 서버의 A 레코드만 담고 있는 것은?
① 주 영역 ② 보조 영역 ③ 스텁 영역 ④ 역방향 조회 영역

> [!ANSWER]
> 정답: ③
> 스텁 영역은 대상 영역을 책임지는 이름 서버가 누구인지만 알고 있는 영역이에요. 보조 영역은 모든 레코드의 읽기 전용 사본을 가져요.
