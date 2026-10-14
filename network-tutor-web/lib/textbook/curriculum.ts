// 처음부터 배우기 · 교재의 목차. 본문은 content/textbook/<slug>.md.
// 순서가 곧 학습 순서다 — 학습 경로는 이 배열을 위에서부터 따라간다.
// quiz.terms는 단원 확인 문제를 문제은행에서 고를 때 쓰는 말(문제 지문에 나오는 표현)이다.

export type ExamSubject =
  | "1과목_네트워크_일반"
  | "2과목_TCP_IP"
  | "3과목_NOS"
  | "4과목_네트워크_운용기기";

export interface Lesson {
  slug: string;
  title: string;
  summary: string;
  quiz?: { subject: ExamSubject; terms: string[] };
}

export interface Part {
  id: string;
  label: string;
  title: string;
  description: string;
  subject?: ExamSubject;
  lessons: Lesson[];
}

export const CURRICULUM: Part[] = [
  {
    id: "start",
    label: "시작",
    title: "시작하기",
    description:
      "시험이 어떻게 생겼는지 알고, 네트워크를 배우는 데 필요한 기초 감각을 먼저 잡아요.",
    lessons: [
      {
        slug: "start-exam-guide",
        title: "네트워크관리사 2급 필기 한눈에 보기",
        summary: "시험 구성과 과목, 이 교재로 공부하는 순서",
      },
      {
        slug: "start-digital-basics",
        title: "비트와 진법 — 컴퓨터가 숫자를 다루는 방법",
        summary: "비트·바이트, 2진수·16진수 변환, 속도와 용량 단위",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: ["2진수", "16진수", "진수", "비트", "바이트"],
        },
      },
      {
        slug: "start-network-big-picture",
        title: "네트워크의 큰 그림",
        summary: "주소·프로토콜·패킷, 웹 페이지 하나가 열리기까지",
      },
    ],
  },
  {
    id: "network-general",
    label: "1과목",
    title: "네트워크 일반",
    description:
      "신호가 선을 타고 가는 원리부터 OSI 7계층, LAN·WAN 기술까지 통신의 바탕을 다져요.",
    subject: "1과목_네트워크_일반",
    lessons: [
      {
        slug: "net-data-communication",
        title: "데이터 통신의 기본",
        summary:
          "통신 시스템의 구성, 단방향·반이중·전이중, 직렬·병렬, 동기·비동기",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "전이중",
            "반이중",
            "단방향",
            "비동기",
            "동기식",
            "직렬",
            "병렬",
            "베이스밴드",
          ],
        },
      },
      {
        slug: "net-signal-modulation",
        title: "신호와 변조",
        summary: "아날로그·디지털 신호, ASK·FSK·PSK·QAM, PCM, 회선 부호화",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "변조",
            "ASK",
            "FSK",
            "PSK",
            "QAM",
            "PCM",
            "양자화",
            "표본화",
            "맨체스터",
            "NRZ",
          ],
        },
      },
      {
        slug: "net-channel-capacity",
        title: "전송 속도와 채널 용량",
        summary: "bps와 baud, 나이퀴스트·샤논 공식, 전송 장애",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "샤논",
            "나이퀴스트",
            "보오",
            "baud",
            "채널 용량",
            "감쇠",
            "잡음",
            "신호 대 잡음",
          ],
        },
      },
      {
        slug: "net-multiplexing",
        title: "다중화와 다중 접속",
        summary: "FDM·TDM·WDM·CDM, 동기식·통계적 TDM, FDMA·TDMA·CDMA",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "다중화",
            "FDM",
            "TDM",
            "WDM",
            "CDMA",
            "TDMA",
            "FDMA",
            "집중화",
          ],
        },
      },
      {
        slug: "net-transmission-media",
        title: "전송 매체와 케이블",
        summary:
          "UTP·STP 카테고리, 동축, 광섬유, 무선 매체, 다이렉트·크로스 케이블",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "UTP",
            "STP",
            "광섬유",
            "동축",
            "케이블",
            "카테고리",
            "Cat",
            "싱글모드",
            "멀티모드",
          ],
        },
      },
      {
        slug: "net-error-flow-control",
        title: "오류 제어와 흐름 제어",
        summary: "패리티·CRC·해밍 코드, ARQ 방식, 슬라이딩 윈도우",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "CRC",
            "해밍",
            "패리티",
            "ARQ",
            "Go-Back-N",
            "슬라이딩 윈도우",
            "흐름 제어",
            "오류 제어",
          ],
        },
      },
      {
        slug: "net-switching",
        title: "교환 방식",
        summary: "회선 교환·메시지 교환·패킷 교환, 데이터그램과 가상 회선",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "회선 교환",
            "패킷 교환",
            "메시지 교환",
            "가상 회선",
            "데이터그램",
            "교환 방식",
          ],
        },
      },
      {
        slug: "net-topology-types",
        title: "네트워크의 분류와 토폴로지",
        summary: "LAN·MAN·WAN, 버스·스타·링·트리·메시, 클라이언트-서버와 P2P",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "토폴로지",
            "성형",
            "버스형",
            "링형",
            "망형",
            "메시",
            "LAN",
            "MAN",
          ],
        },
      },
      {
        slug: "net-osi-model",
        title: "OSI 7계층",
        summary: "계층별 역할과 데이터 단위, 대표 프로토콜과 장비, 캡슐화",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "OSI",
            "계층",
            "물리 계층",
            "데이터 링크",
            "전송 계층",
            "세션 계층",
            "표현 계층",
            "응용 계층",
          ],
        },
      },
      {
        slug: "net-lan-ethernet",
        title: "LAN 표준과 이더넷",
        summary:
          "IEEE 802 시리즈, MAC 주소와 이더넷 프레임, CSMA/CD, 이더넷 규격 읽는 법",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "IEEE 802",
            "이더넷",
            "CSMA/CD",
            "MAC 주소",
            "BASE",
            "토큰 링",
            "프레임",
          ],
        },
      },
      {
        slug: "net-wireless-lan",
        title: "무선 LAN과 근거리 무선 통신",
        summary:
          "802.11 규격, CSMA/CA, SSID와 AP, 무선 보안, 블루투스·NFC·지그비",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "802.11",
            "무선",
            "CSMA/CA",
            "SSID",
            "WPA",
            "블루투스",
            "지그비",
            "NFC",
          ],
        },
      },
      {
        slug: "net-wan-technologies",
        title: "WAN 기술",
        summary: "전용 회선, X.25·프레임 릴레이·ATM, ISDN·xDSL, PPP·HDLC, MPLS",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "X.25",
            "프레임 릴레이",
            "ATM",
            "ISDN",
            "ADSL",
            "xDSL",
            "HDLC",
            "PPP",
            "MPLS",
          ],
        },
      },
      {
        slug: "net-mobile-convergence",
        title: "이동 통신과 새로운 네트워크",
        summary: "셀룰러와 핸드오프, 4G·5G, IoT, 클라우드, SDN·NFV",
        quiz: {
          subject: "1과목_네트워크_일반",
          terms: [
            "이동 통신",
            "LTE",
            "5G",
            "핸드오프",
            "IoT",
            "클라우드",
            "SDN",
            "셀룰러",
          ],
        },
      },
    ],
  },
  {
    id: "tcpip",
    label: "2과목",
    title: "TCP/IP",
    description:
      "인터넷이 실제로 쓰는 약속들 — IP 주소와 서브넷, TCP·UDP, DNS, 라우팅, IPv6를 배워요.",
    subject: "2과목_TCP_IP",
    lessons: [
      {
        slug: "tcpip-model",
        title: "TCP/IP 모델과 캡슐화",
        summary:
          "4계층 구조와 OSI 대응, 계층별 프로토콜, 헤더가 붙고 떨어지는 과정",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: ["TCP/IP", "캡슐화", "인터넷 계층", "네트워크 접근", "4계층"],
        },
      },
      {
        slug: "tcpip-ipv4-address",
        title: "IPv4 주소 체계",
        summary: "32비트 주소, 클래스 A~E, 사설 IP, 특수 주소",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "클래스",
            "사설",
            "IPv4",
            "루프백",
            "브로드캐스트",
            "127.0.0.1",
            "B 클래스",
            "C 클래스",
          ],
        },
      },
      {
        slug: "tcpip-subnetting",
        title: "서브넷 마스크와 서브네팅",
        summary:
          "네트워크·브로드캐스트 주소 구하기, 호스트 수 계산, 단계별 예제",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "서브넷",
            "서브네팅",
            "서브넷 마스크",
            "255.255",
            "호스트 수",
            "네트워크 주소",
          ],
        },
      },
      {
        slug: "tcpip-cidr-vlsm",
        title: "CIDR·VLSM·슈퍼네팅",
        summary: "클래스 없는 주소, 가변 길이 서브넷, 경로 요약",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: ["CIDR", "VLSM", "슈퍼넷", "슈퍼네팅", "프리픽스", "요약"],
        },
      },
      {
        slug: "tcpip-ip-header",
        title: "IP 패킷의 구조와 단편화",
        summary: "IPv4 헤더 필드, TTL과 프로토콜 번호, MTU와 단편화",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "헤더",
            "TTL",
            "단편화",
            "MTU",
            "Fragment",
            "IHL",
            "Identification",
          ],
        },
      },
      {
        slug: "tcpip-arp-icmp",
        title: "ARP·ICMP·IGMP",
        summary: "IP로 MAC 찾기, 오류와 진단 메시지, 멀티캐스트 그룹 관리",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: ["ARP", "RARP", "ICMP", "IGMP", "ping", "Echo"],
        },
      },
      {
        slug: "tcpip-tcp",
        title: "TCP",
        summary: "연결 설정과 종료, 순서 번호와 확인 응답, 흐름·혼잡 제어",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "TCP",
            "3-way",
            "핸드셰이크",
            "SYN",
            "ACK",
            "FIN",
            "혼잡 제어",
            "윈도우",
          ],
        },
      },
      {
        slug: "tcpip-udp-ports",
        title: "UDP와 포트 번호",
        summary: "UDP의 특징, TCP와 비교, 꼭 외울 잘 알려진 포트",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: ["UDP", "포트", "Well-known", "소켓"],
        },
      },
      {
        slug: "tcpip-dns-dhcp",
        title: "DNS와 DHCP",
        summary: "도메인 이름 해석, 레코드 종류, DHCP 주소 할당 과정",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "DNS",
            "DHCP",
            "레코드",
            "MX",
            "CNAME",
            "PTR",
            "도메인",
            "DISCOVER",
          ],
        },
      },
      {
        slug: "tcpip-application-protocols",
        title: "응용 계층 프로토콜",
        summary: "HTTP·FTP·메일·원격 접속·SNMP·NTP",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "HTTP",
            "FTP",
            "SMTP",
            "POP3",
            "IMAP",
            "Telnet",
            "SSH",
            "SNMP",
          ],
        },
      },
      {
        slug: "tcpip-routing-basics",
        title: "라우팅의 원리",
        summary: "라우팅 테이블, 정적·기본 경로, 메트릭과 관리 거리",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "라우팅",
            "라우팅 테이블",
            "정적 라우팅",
            "기본 경로",
            "메트릭",
            "디폴트 게이트웨이",
          ],
        },
      },
      {
        slug: "tcpip-routing-protocols",
        title: "동적 라우팅 프로토콜",
        summary: "거리 벡터와 링크 상태, RIP·OSPF·EIGRP·BGP",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "RIP",
            "OSPF",
            "BGP",
            "EIGRP",
            "거리 벡터",
            "링크 상태",
            "IGP",
            "EGP",
          ],
        },
      },
      {
        slug: "tcpip-nat-multicast",
        title: "NAT와 전송 방식",
        summary: "NAT·PAT, 유니캐스트·브로드캐스트·멀티캐스트·애니캐스트",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "NAT",
            "PAT",
            "멀티캐스트",
            "유니캐스트",
            "애니캐스트",
            "주소 변환",
          ],
        },
      },
      {
        slug: "tcpip-ipv6",
        title: "IPv6",
        summary: "128비트 주소 표기와 축약, 주소 유형, 헤더, 전환 기술",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "IPv6",
            "128",
            "듀얼 스택",
            "터널링",
            "애니캐스트",
            "확장 헤더",
          ],
        },
      },
      {
        slug: "tcpip-security-protocols",
        title: "네트워크 보안 기초",
        summary: "암호 방식, SSL/TLS·IPSec·VPN, 대표적인 공격 기법",
        quiz: {
          subject: "2과목_TCP_IP",
          terms: [
            "IPSec",
            "SSL",
            "TLS",
            "VPN",
            "스푸핑",
            "스니핑",
            "DoS",
            "암호화",
          ],
        },
      },
    ],
  },
  {
    id: "nos",
    label: "3과목",
    title: "NOS (네트워크 운영체제)",
    description:
      "서버를 직접 다루는 과목이에요. Windows Server와 리눅스의 개념·명령어·서비스를 익혀요.",
    subject: "3과목_NOS",
    lessons: [
      {
        slug: "nos-os-basics",
        title: "운영체제와 네트워크 운영체제",
        summary:
          "운영체제의 역할, 프로세스와 메모리, 파일 시스템, 서버 운영체제",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "운영체제",
            "프로세스",
            "스레드",
            "파일 시스템",
            "커널",
            "가상 메모리",
          ],
        },
      },
      {
        slug: "nos-windows-server-intro",
        title: "Windows Server 시작하기",
        summary: "에디션과 설치 옵션, 서버 관리자와 역할·기능, PowerShell",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "Windows Server",
            "서버 관리자",
            "역할",
            "Server Core",
            "PowerShell",
            "에디션",
          ],
        },
      },
      {
        slug: "nos-windows-ad",
        title: "Active Directory와 그룹 정책",
        summary: "도메인·트리·포리스트·OU, 도메인 컨트롤러, 그룹 정책",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "Active Directory",
            "도메인 컨트롤러",
            "포리스트",
            "OU",
            "그룹 정책",
            "GPO",
            "트리",
          ],
        },
      },
      {
        slug: "nos-windows-file-permissions",
        title: "Windows 파일 시스템과 권한",
        summary: "NTFS 권한과 공유 권한, 디스크 관리, 암호화와 할당량",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "NTFS",
            "공유 권한",
            "FAT32",
            "ReFS",
            "EFS",
            "BitLocker",
            "할당량",
            "동적 디스크",
          ],
        },
      },
      {
        slug: "nos-windows-network-services",
        title: "Windows 네트워크 서비스",
        summary: "DNS·DHCP 서버, IIS, 원격 데스크톱, Hyper-V, 모니터링 도구",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "IIS",
            "DHCP 서버",
            "DNS 서버",
            "원격 데스크톱",
            "Hyper-V",
            "이벤트 뷰어",
            "WSUS",
          ],
        },
      },
      {
        slug: "nos-windows-commands",
        title: "Windows 네트워크 명령어",
        summary: "ipconfig·ping·tracert·nslookup·netstat·arp·route",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "ipconfig",
            "tracert",
            "nslookup",
            "netstat",
            "pathping",
            "nbtstat",
            "route",
          ],
        },
      },
      {
        slug: "nos-linux-intro",
        title: "리눅스 기초",
        summary: "배포판과 커널·셸, 디렉터리 구조, 부팅과 systemd",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "리눅스",
            "Linux",
            "커널",
            "배포판",
            "디렉터리",
            "/etc",
            "부팅",
            "런레벨",
          ],
        },
      },
      {
        slug: "nos-linux-files-commands",
        title: "리눅스 파일 다루기",
        summary:
          "파일·디렉터리 명령어, 찾기와 보기, 링크, 압축, 리다이렉션과 파이프",
        quiz: {
          subject: "3과목_NOS",
          terms: ["ls", "cp", "find", "grep", "tar", "ln", "mkdir", "명령어"],
        },
      },
      {
        slug: "nos-linux-permissions-users",
        title: "리눅스 권한과 사용자",
        summary:
          "rwx와 8진수 권한, chmod·chown·umask, 특수 권한, 사용자·그룹 관리",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "chmod",
            "chown",
            "umask",
            "퍼미션",
            "권한",
            "/etc/passwd",
            "/etc/shadow",
            "useradd",
          ],
        },
      },
      {
        slug: "nos-linux-process-system",
        title: "리눅스 프로세스와 시스템 관리",
        summary: "ps·top·kill, systemctl, cron, 패키지 관리, 디스크와 로그",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "ps",
            "kill",
            "cron",
            "crontab",
            "systemctl",
            "rpm",
            "yum",
            "mount",
          ],
        },
      },
      {
        slug: "nos-linux-network-servers",
        title: "리눅스 네트워크 설정과 서버",
        summary:
          "네트워크 설정 명령과 파일, 방화벽, Apache·Samba·NFS·FTP·DNS 서버",
        quiz: {
          subject: "3과목_NOS",
          terms: [
            "ifconfig",
            "Apache",
            "Samba",
            "NFS",
            "iptables",
            "firewalld",
            "resolv.conf",
            "httpd",
          ],
        },
      },
      {
        slug: "nos-vi-shell",
        title: "vi 편집기와 셸",
        summary: "vi의 모드와 주요 명령, 셸 종류와 환경 변수, 간단한 스크립트",
        quiz: {
          subject: "3과목_NOS",
          terms: ["vi", "셸", "bash", "환경 변수", "명령 모드", "PATH"],
        },
      },
    ],
  },
  {
    id: "devices",
    label: "4과목",
    title: "네트워크 운용기기",
    description:
      "허브·스위치·라우터부터 보안 장비와 스토리지까지, 네트워크를 이루는 장비를 알아봐요.",
    subject: "4과목_네트워크_운용기기",
    lessons: [
      {
        slug: "dev-l1-l2-devices",
        title: "1·2계층 장비",
        summary:
          "NIC·리피터·허브·브리지·스위치, 충돌 도메인과 브로드캐스트 도메인",
        quiz: {
          subject: "4과목_네트워크_운용기기",
          terms: [
            "허브",
            "리피터",
            "브리지",
            "스위치",
            "충돌 도메인",
            "NIC",
            "Cut-through",
          ],
        },
      },
      {
        slug: "dev-switch-vlan-stp",
        title: "스위치 심화 — VLAN과 STP",
        summary: "VLAN과 트렁크, 스패닝 트리, 링크 묶기, PoE와 포트 미러링",
        quiz: {
          subject: "4과목_네트워크_운용기기",
          terms: [
            "VLAN",
            "STP",
            "스패닝 트리",
            "트렁크",
            "802.1Q",
            "PoE",
            "루트 브리지",
          ],
        },
      },
      {
        slug: "dev-router-l3",
        title: "라우터와 상위 계층 장비",
        summary:
          "라우터의 구성과 역할, L3·L4·L7 스위치, 로드 밸런서, 게이트웨이",
        quiz: {
          subject: "4과목_네트워크_운용기기",
          terms: [
            "라우터",
            "L3",
            "L4",
            "L7",
            "게이트웨이",
            "로드 밸런",
            "부하 분산",
          ],
        },
      },
      {
        slug: "dev-router-config",
        title: "라우터·스위치 기본 설정",
        summary: "CLI 모드, 인터페이스 설정, 정적 라우팅, show 명령, 설정 저장",
        quiz: {
          subject: "4과목_네트워크_운용기기",
          terms: [
            "show",
            "running-config",
            "enable",
            "configure terminal",
            "interface",
            "ip route",
          ],
        },
      },
      {
        slug: "dev-security-appliances",
        title: "보안 장비",
        summary: "방화벽의 종류, DMZ, IDS·IPS, UTM·WAF, VPN 장비, NAC",
        quiz: {
          subject: "4과목_네트워크_운용기기",
          terms: ["방화벽", "IDS", "IPS", "DMZ", "UTM", "VPN", "침입"],
        },
      },
      {
        slug: "dev-wireless-equipment",
        title: "무선 장비",
        summary: "AP와 무선 컨트롤러, 안테나, 무선 브리지와 메시",
        quiz: {
          subject: "4과목_네트워크_운용기기",
          terms: ["AP", "무선", "안테나", "액세스 포인트", "무선 랜"],
        },
      },
      {
        slug: "dev-server-storage",
        title: "서버·스토리지와 이중화",
        summary: "RAID 레벨, DAS·NAS·SAN, 백업 방식, UPS와 고가용성",
        quiz: {
          subject: "4과목_네트워크_운용기기",
          terms: ["RAID", "NAS", "SAN", "DAS", "백업", "UPS", "이중화"],
        },
      },
      {
        slug: "dev-cabling-tools",
        title: "케이블링과 점검 도구",
        summary:
          "구조화 배선, 패치 패널과 랙, 광 커넥터와 트랜시버, 테스터와 장애 처리",
        quiz: {
          subject: "4과목_네트워크_운용기기",
          terms: ["패치 패널", "OTDR", "커넥터", "SFP", "테스터", "배선", "광"],
        },
      },
    ],
  },
];

export const ALL_LESSONS: (Lesson & { part: Part; index: number })[] =
  CURRICULUM.flatMap((part) =>
    part.lessons.map((lesson) => ({ ...lesson, part }))
  ).map((l, index) => ({ ...l, index }));

export function findLesson(slug: string) {
  return ALL_LESSONS.find((l) => l.slug === slug) ?? null;
}

export function neighbors(slug: string) {
  const i = ALL_LESSONS.findIndex((l) => l.slug === slug);
  return {
    prev: i > 0 ? ALL_LESSONS[i - 1] : null,
    next: i >= 0 && i < ALL_LESSONS.length - 1 ? ALL_LESSONS[i + 1] : null,
  };
}
