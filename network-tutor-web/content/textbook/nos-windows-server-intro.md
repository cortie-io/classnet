Windows Server는 회사 네트워크에서 계정 관리, 파일 공유, DNS·DHCP 같은 서비스를 맡는 Microsoft의 서버 운영체제예요. 이 단원에서는 에디션과 설치 옵션을 고르는 기준, 서버를 처음 켰을 때 만나는 서버 관리자, 시험에 자주 나오는 역할과 기능의 차이, 그리고 PowerShell과 원격 관리의 기본을 배워요. 이 교재의 Windows 내용은 Windows Server 2016 이후 버전을 기준으로 해요.

> [!GOAL]
> - Standard·Datacenter·Essentials 에디션과 Server Core·데스크톱 환경 설치 옵션을 구분할 수 있다
> - 역할·역할 서비스·기능을 예를 들어 구분할 수 있다
> - PowerShell cmdlet의 동사-명사 규칙을 알고 기본 명령을 읽을 수 있다
> - MMC 스냅인, Windows Admin Center, 원격 관리 방법을 설명할 수 있다

## Windows Server의 버전과 에디션

### 버전

Windows Server는 2016, 2019, 2022처럼 연도가 붙은 이름으로 나오고, 그 뒤로도 새 버전이 계속 나오고 있어요. 이런 정식 버전은 장기 서비스 채널(LTSC, Long-Term Servicing Channel)로 제공되어 일반 지원 5년과 연장 지원 5년, 합쳐서 대략 10년 동안 보안 업데이트를 받아요. 또 2008 R2부터는 64비트 버전만 나오므로 32비트 CPU에는 설치할 수 없어요.

### 에디션

같은 버전 안에서도 쓰임새에 따라 에디션(Edition)이 나뉘어요. 시험에는 주로 다음 세 가지가 나와요.

| 에디션 | 대상 | 특징 |
|---|---|---|
| Essentials | 소규모 사업장 | 사용자 약 25명, 장치 약 50대 이하로 제한. 프로세서 수 등에도 제한이 있고 버전마다 조건이 조금씩 다름 |
| Standard | 일반 기업, 가상화를 적게 쓰는 환경 | 대부분의 역할과 기능 제공. 라이선스 한 벌로 가상 머신 2개까지 실행 권한 |
| Datacenter | 가상화를 많이 쓰는 데이터 센터, 클라우드 | Standard의 모든 기능 + 가상 머신 무제한 실행 권한 + 스토리지 공간 다이렉트(S2D), 차폐된 가상 머신(Shielded VM), 소프트웨어 정의 네트워킹(SDN) 같은 고급 기능 |

Standard와 Datacenter는 서버의 물리 코어 수를 기준으로 라이선스를 사고, 서버에 접속하는 사용자나 장치마다 클라이언트 액세스 라이선스(CAL, Client Access License)도 따로 필요해요. 원격 데스크톱 세션 호스트를 쓰려면 원격 데스크톱 서비스용 CAL(RDS CAL)이 추가로 들어요.

> [!EXAM]
> "가상 머신을 개수 제한 없이 실행할 수 있는 에디션"은 Datacenter예요. Standard는 가상 머신 2개까지라는 점과 짝지어 기억하세요.

## 설치 옵션

### 데스크톱 환경과 Server Core

설치 프로그램에서 에디션을 고를 때 같은 에디션이 두 줄로 보여요. 이름 뒤에 '(데스크톱 환경)'이 붙은 것이 GUI가 있는 설치이고, 붙지 않은 것이 Server Core예요. 기본으로 선택된 것은 Server Core예요.

| 구분 | Server Core | 데스크톱 환경(Desktop Experience) |
|---|---|---|
| 화면 | GUI 없음. 명령 프롬프트, PowerShell, sconfig로 관리 | 시작 메뉴, 파일 탐색기, 서버 관리자 등 전체 GUI |
| 디스크·메모리 사용량 | 적음 | 많음 |
| 업데이트와 재부팅 횟수 | 적음 | 많음 |
| 공격 표면(공격받을 수 있는 구성 요소) | 작아서 보안에 유리 | 큼 |
| 주 관리 방법 | 다른 컴퓨터에서 원격 관리 | 로컬 GUI와 원격 관리 모두 |

Server Core에서 처음 설정할 때는 sconfig라는 메뉴형 도구를 써요. 번호를 골라 컴퓨터 이름 변경, 도메인 가입, IP 설정, 원격 데스크톱 허용, Windows 업데이트 같은 작업을 할 수 있어요. Windows Server 2022에서는 Server Core에 로그온하면 sconfig가 자동으로 떠요.

> [!WARNING]
> Windows Server 2016부터는 설치한 뒤에 Server Core와 데스크톱 환경을 서로 바꿀 수 없어요. 바꾸려면 다시 설치해야 해요. 예전 버전(2012, 2012 R2)에서 가능했던 전환 방법과 헷갈리지 마세요.

> [!NOTE]
> 하드웨어 최소 사양은 대략 1.4GHz 64비트 프로세서, 메모리 512MB(Server Core) 또는 2GB(데스크톱 환경), 디스크 32GB예요. 실제 운영에는 훨씬 넉넉한 사양이 필요해요. Windows를 설치하는 볼륨은 NTFS여야 해요.

### Nano Server

Nano Server는 Windows Server 2016에서 처음 선보인 초경량 설치 옵션이에요. 로컬 로그온 화면조차 없이 원격으로만 관리하는 형태였어요. 이후 버전에서는 물리·가상 서버에 설치하는 옵션에서 빠지고, 지금은 컨테이너(Container)를 만들 때 쓰는 기본 이미지로만 제공돼요.

## 서버 관리자

서버 관리자(Server Manager)는 데스크톱 환경에 로그온하면 자동으로 열리는 통합 관리 화면이에요.

- 대시보드: 서버와 설치된 역할의 상태를 한눈에 보여 줘요.
- 로컬 서버: 컴퓨터 이름, 작업 그룹·도메인 소속, 방화벽, 원격 관리, 원격 데스크톱, NIC 팀, 네트워크 어댑터 IP, 표준 시간대 등을 바로 확인하고 바꿀 수 있어요.
- 모든 서버: 관리 대상으로 추가한 다른 서버들을 함께 보여 줘요.
- 역할별 메뉴: DNS, 파일 및 저장소 서비스처럼 설치한 역할마다 메뉴가 생겨요.
- 관리 메뉴: 역할 및 기능 추가·제거, 관리할 서버 추가, 서버 그룹 만들기.
- 도구 메뉴: 이벤트 뷰어, 서비스, DNS 관리자 같은 관리 도구 바로 가기.

'역할 및 기능 추가 마법사'는 설치 유형 선택(역할 기반 또는 기능 기반 설치 / 원격 데스크톱 서비스 설치) → 대상 서버 선택 → 서버 역할 → 기능 → 확인 → 설치 순서로 진행돼요.

## 역할, 역할 서비스, 기능

서버를 가게에 비유해 볼게요. 역할은 간판에 쓰는 주력 업종(빵집)이고, 역할 서비스는 그 업종 안의 세부 메뉴(케이크, 식빵)이며, 기능은 업종과 상관없이 가게 운영을 돕는 설비(CCTV, 금고)예요.

- 역할(Role): 서버가 네트워크의 사용자와 컴퓨터에게 제공하는 주된 서비스
- 역할 서비스(Role Service): 한 역할을 이루는 세부 구성 요소. 필요한 것만 골라 설치해요
- 기능(Feature): 특정 역할과 별개로 서버 자체를 돕거나 여러 역할을 보조하는 구성 요소

| 역할 | 하는 일 | 역할 서비스의 예 |
|---|---|---|
| Active Directory 도메인 서비스(AD DS) | 계정과 컴퓨터 중앙 관리, 인증 | — |
| DNS 서버 | 이름을 IP 주소로 해석 | — |
| DHCP 서버 | IP 주소 자동 할당 | — |
| 웹 서버(IIS) | 웹·FTP 서비스 | 웹 서버, FTP 서버, 관리 도구 |
| 파일 및 저장소 서비스 | 파일 공유와 저장소 관리 | 파일 서버, DFS 네임스페이스, DFS 복제, 파일 서버 리소스 관리자 |
| 원격 데스크톱 서비스 | 여러 사용자에게 원격 작업 환경 제공 | RD 세션 호스트, RD 게이트웨이, RD 라이선싱, RD 웹 액세스, RD 연결 브로커 |
| Hyper-V | 가상 머신 실행 | — |
| 인쇄 및 문서 서비스 | 네트워크 프린터 관리 | 인쇄 서버 |
| Windows Server Update Services(WSUS) | 업데이트를 사내에 배포 | — |
| Active Directory 인증서 서비스(AD CS) | 디지털 인증서 발급 | 인증 기관 |

기능의 예로는 다음과 같은 것들이 있어요.

- 장애 조치 클러스터링(Failover Clustering)
- 네트워크 부하 분산(NLB, Network Load Balancing)
- BitLocker 드라이브 암호화
- Windows Server 백업
- .NET Framework
- 그룹 정책 관리, 원격 서버 관리 도구(RSAT)
- 텔넷 클라이언트, SNMP 서비스, 다중 경로 I/O(MPIO)

> [!EXAM]
> "다음 중 역할이 아닌 것은?" 같은 문제가 자주 나와요. Windows Server 백업, 장애 조치 클러스터링, 네트워크 부하 분산, BitLocker, 텔넷 클라이언트는 '기능'이에요. DNS, DHCP, IIS, AD DS, Hyper-V는 '역할'이에요.

## PowerShell 기초

### cmdlet과 동사-명사 규칙

PowerShell은 Microsoft가 만든 명령 줄 셸이자 스크립트 언어예요. 명령 결과를 단순한 글자가 아니라 속성을 가진 객체(Object)로 주고받는 것이 특징이에요. Windows Server 2016 이후에는 Windows PowerShell 5.1이 기본으로 들어 있고, 여러 운영체제에서 돌아가는 PowerShell 7은 따로 설치해요.

PowerShell의 기본 명령을 cmdlet(커맨들릿)이라고 해요. cmdlet 이름은 모두 동사-명사(Verb-Noun) 형식이에요. 동사 부분에는 Get(가져오기), Set(설정), New(만들기), Remove(제거), Start, Stop, Restart, Install, Test 같은 정해진 단어를 써요. 대소문자는 구분하지 않고, 매개 변수는 `-Name`처럼 하이픈으로 시작해요.

| cmdlet | 하는 일 |
|---|---|
| `Get-Help` | 명령 도움말 보기(`Get-Help Get-Service -Examples`). `Update-Help`로 최신 도움말 받기 |
| `Get-Command` | 명령 찾기(`Get-Command *Service*`) |
| `Get-Service`, `Start-Service`, `Stop-Service`, `Restart-Service` | 서비스 상태 확인과 제어 |
| `Get-Process`, `Stop-Process` | 프로세스 확인과 종료 |
| `Get-WindowsFeature` | 역할·기능 목록과 설치 상태 |
| `Install-WindowsFeature`, `Uninstall-WindowsFeature` | 역할·기능 설치와 제거 |
| `Rename-Computer`, `Add-Computer`, `Restart-Computer` | 컴퓨터 이름 변경, 도메인 가입, 다시 시작 |

자주 쓰는 명령어에는 짧은 별칭(Alias)도 있어요. 예를 들어 `dir`과 `ls`는 `Get-ChildItem`, `cd`는 `Set-Location`, `cls`는 `Clear-Host`의 별칭이에요.

### 예제로 읽어 보기

```powershell
# 이름에 DNS가 들어간 역할·기능 찾기
Get-WindowsFeature -Name *DNS*

# DHCP 서버 역할을 관리 도구와 함께 설치
Install-WindowsFeature -Name DHCP -IncludeManagementTools

# 인쇄 스풀러 서비스 상태 확인 후 다시 시작
Get-Service -Name Spooler
Restart-Service -Name Spooler

# 실행 중인 서비스만 골라 보기 (파이프라인)
Get-Service | Where-Object Status -eq 'Running'
```

`Get-WindowsFeature`를 실행하면 설치된 항목 앞에 `[X]`, 설치되지 않은 항목 앞에 `[ ]`가 붙어서 나와요.

```text
Display Name                      Name      Install State
------------                      ----      -------------
[X] DNS 서버                       DNS       Installed
[ ] DHCP 서버                      DHCP      Available
```

- 파이프라인(`|`)은 앞 명령의 결과 객체를 뒤 명령에 넘겨줘요.
- `-IncludeManagementTools`를 붙여야 관리 도구(콘솔)까지 함께 설치돼요. GUI 마법사에서는 기본으로 체크되지만 PowerShell에서는 직접 지정해야 해요.
- `-IncludeAllSubFeature`는 하위 역할 서비스를 모두 설치하고, `-Restart`는 필요하면 자동으로 다시 시작해요.

> [!NOTE]
> 스크립트 파일(.ps1)을 실행할 수 있는지는 실행 정책(Execution Policy)이 정해요. Windows Server의 기본값은 RemoteSigned로, 인터넷에서 받은 스크립트는 서명이 있어야 실행돼요. `Get-ExecutionPolicy`로 확인할 수 있어요.

## MMC와 관리 도구

MMC(Microsoft Management Console)는 여러 관리 도구를 '스냅인(Snap-in)'이라는 부품으로 끼워 쓰는 공통 틀이에요. `mmc`를 실행한 뒤 [파일] → [스냅인 추가/제거]로 원하는 도구를 모아 나만의 콘솔(.msc 파일)을 만들 수 있어요. 대부분의 스냅인은 다른 컴퓨터에 연결해서 원격으로 관리할 수도 있어요.

서버 관리자의 [도구] 메뉴나 시작 메뉴의 관리 도구(버전에 따라 'Windows 관리 도구') 폴더에 미리 만들어진 콘솔이 있어요. 실행 창(Win+R)에 아래 이름을 입력해 바로 열 수도 있어요.

| 실행 이름 | 도구 |
|---|---|
| `compmgmt.msc` | 컴퓨터 관리(여러 스냅인을 묶은 콘솔) |
| `services.msc` | 서비스 |
| `eventvwr.msc` | 이벤트 뷰어 |
| `diskmgmt.msc` | 디스크 관리 |
| `devmgmt.msc` | 장치 관리자 |
| `lusrmgr.msc` | 로컬 사용자 및 그룹 |
| `gpedit.msc` | 로컬 그룹 정책 편집기 |
| `secpol.msc` | 로컬 보안 정책 |
| `perfmon.msc` | 성능 모니터 |
| `wf.msc` | 고급 보안이 포함된 Windows Defender 방화벽 |
| `dsa.msc` | Active Directory 사용자 및 컴퓨터 |
| `gpmc.msc` | 그룹 정책 관리 |
| `dnsmgmt.msc` | DNS 관리자 |
| `dhcpmgmt.msc` | DHCP 관리 |

제어판 항목으로는 `ncpa.cpl`(네트워크 연결), `sysdm.cpl`(시스템 속성)이 자주 쓰여요.

> [!WARNING]
> 도메인 컨트롤러에는 로컬 사용자 데이터베이스가 없어서 '로컬 사용자 및 그룹'(lusrmgr.msc)을 쓸 수 없어요. 도메인 컨트롤러의 계정은 'Active Directory 사용자 및 컴퓨터'에서 관리해요.

## Windows Admin Center

Windows Admin Center는 웹 브라우저로 서버를 관리하는 무료 도구예요. Windows Server에 기본 설치되어 있지 않아서 따로 내려받아 관리용 PC나 서버(게이트웨이)에 설치하고, 브라우저로 HTTPS 접속해서 써요. 서버, 클러스터, Windows 10·11 PC를 한 화면에서 관리할 수 있고, 서버 관리자와 여러 MMC 도구의 기능을 모아 두어서 GUI가 없는 Server Core를 관리할 때 특히 편리해요.

## 원격 관리

서버는 보통 전산실이나 데이터 센터에 있으므로 관리자는 대부분 원격으로 작업해요.

| 방법 | 설명 | 포트·도구 |
|---|---|---|
| 원격 데스크톱(RDP) | 서버 화면을 그대로 받아 GUI로 조작. 관리 목적이면 추가 라이선스 없이 동시 2세션까지 | TCP 3389, `mstsc` |
| 서버 관리자 | 다른 서버를 관리 대상으로 추가해 한 화면에서 관리 | WinRM 사용 |
| PowerShell 원격(PowerShell Remoting) | WinRM(Windows 원격 관리) 위에서 원격 명령 실행 | HTTP 5985, HTTPS 5986 |
| MMC 스냅인 | 콘솔에서 '다른 컴퓨터에 연결' | — |
| 원격 서버 관리 도구(RSAT) | Windows 10·11 PC에 서버 관리 콘솔 설치 | 선택적 기능으로 추가 |
| Windows Admin Center | 웹 브라우저로 관리 | HTTPS |
| OpenSSH 서버 | Windows Server 2019부터 선택적 기능으로 설치 가능 | TCP 22 |

WinRM은 Windows Server에서 기본으로 켜져 있어서 PowerShell 원격을 바로 쓸 수 있어요.

```powershell
# 원격 관리 허용 (꺼져 있을 때만 필요)
Enable-PSRemoting -Force

# 원격 서버 FS01에 대화형으로 접속 (빠져나올 때는 Exit-PSSession)
Enter-PSSession -ComputerName FS01

# 여러 서버에서 같은 명령을 한 번에 실행
Invoke-Command -ComputerName FS01, FS02 -ScriptBlock { Get-Service -Name W32Time }
```

설치 직후 기본 설정도 PowerShell로 할 수 있어요. 아래는 이름을 바꾸고, 고정 IP와 DNS 서버를 지정한 뒤 도메인에 가입하는 예예요. `-Restart`가 붙은 명령은 실행하자마자 다시 시작하므로, 다시 로그온한 뒤 다음 단계를 이어 가요.

```powershell
# 1단계: 컴퓨터 이름을 바꾸고 다시 시작
Rename-Computer -NewName "SRV01" -Restart

# 2단계: 고정 IP·게이트웨이와 DNS 서버(사내 AD DNS) 지정
New-NetIPAddress -InterfaceAlias "이더넷" -IPAddress 192.168.10.20 -PrefixLength 24 -DefaultGateway 192.168.10.1
Set-DnsClientServerAddress -InterfaceAlias "이더넷" -ServerAddresses 192.168.10.10

# 3단계: 도메인에 가입하고 다시 시작
Add-Computer -DomainName "hanbit.example.com" -Restart
```

## 핵심 정리

- Windows Server는 64비트 전용이고, 정식 버전은 대략 10년(일반 5년 + 연장 5년) 지원돼요.
- Essentials는 소규모(사용자 약 25명), Standard는 가상 머신 2개, Datacenter는 가상 머신 무제한과 고급 기능을 제공해요.
- Server Core는 GUI가 없어 가볍고 보안에 유리해요. 2016부터는 설치 후 데스크톱 환경과 서로 전환할 수 없어요.
- Nano Server는 지금은 컨테이너 기본 이미지로만 제공돼요.
- 역할은 주된 서비스(AD DS, DNS, DHCP, IIS, Hyper-V), 역할 서비스는 역할의 세부 구성 요소, 기능은 보조 구성 요소(Windows Server 백업, 장애 조치 클러스터링, BitLocker)예요.
- PowerShell cmdlet은 동사-명사 형식이에요. 역할 설치는 `Install-WindowsFeature`, 도움말은 `Get-Help`, 서비스 확인은 `Get-Service`예요.
- MMC는 스냅인을 담는 틀이고, 각 관리 도구는 .msc 파일로 실행해요.
- 원격 관리는 RDP(TCP 3389, 관리용 동시 2세션), WinRM 기반 PowerShell 원격(5985/5986), Windows Admin Center 등으로 해요.

## 스스로 확인하기

**1.** 한빛상사는 서버 한 대에서 가상 머신을 수십 개 운영하려고 한다. 가상 머신 실행 개수에 제한이 없는 에디션은?
① Essentials ② Standard ③ Datacenter ④ Server Core

> [!ANSWER]
> 정답: ③
> Datacenter 에디션은 가상 머신을 무제한으로 실행할 권한을 줘요. Server Core는 에디션이 아니라 설치 옵션이에요.

**2.** 다음 중 Windows Server의 '역할'이 아니라 '기능'에 해당하는 것은?
① DNS 서버 ② DHCP 서버 ③ Windows Server 백업 ④ 웹 서버(IIS)

> [!ANSWER]
> 정답: ③
> Windows Server 백업은 기능이에요. 나머지는 네트워크에 서비스를 제공하는 역할이에요.

**3.** Windows Server 2016 이후의 Server Core 설치 옵션에 대한 설명으로 옳지 않은 것은?
① 데스크톱 환경보다 디스크와 메모리를 적게 쓴다 ② sconfig로 기본 설정을 할 수 있다 ③ 설치 후 서버 관리자에서 데스크톱 환경으로 전환할 수 있다 ④ 공격 표면이 작아 보안에 유리하다

> [!ANSWER]
> 정답: ③
> 2016부터는 설치 후 Server Core와 데스크톱 환경을 서로 바꿀 수 없고 다시 설치해야 해요.

**4.** PowerShell에서 DHCP 서버 역할을 관리 콘솔까지 함께 설치하는 명령으로 알맞은 것은?
① `Get-WindowsFeature -Name DHCP` ② `Install-WindowsFeature -Name DHCP -IncludeManagementTools` ③ `Start-Service -Name DHCP -IncludeManagementTools` ④ `Add-Computer -Name DHCP`

> [!ANSWER]
> 정답: ②
> 역할·기능 설치는 `Install-WindowsFeature`이고, 관리 도구까지 설치하려면 `-IncludeManagementTools`를 붙여요.

**5.** PowerShell 원격(Enter-PSSession, Invoke-Command)이 기반으로 사용하는 Windows 서비스는?
① WinRM ② RDP ③ SMB ④ WSUS

> [!ANSWER]
> 정답: ①
> PowerShell 원격은 WinRM(Windows 원격 관리)을 통해 동작하며 기본 포트는 HTTP 5985, HTTPS 5986이에요.
