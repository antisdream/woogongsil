// Home page feature module for chatPresets.
export const CHAT_EMOJI_PRESETS = [
    '👍', '👏', '🙌', '👋', '🔥', '🎉', '✅', '😂', '🤣', '🥲', '😭', '😎',
    '🤔', '😮', '🙏', '💯', '❤️', '💙', '💚', '💪', '🚀', '📌', '⭐', '🍀',
    '🤖', '📚', '📝', '⏰', '☕', '🌙', '☀️', '✨', '🙆‍♂️', '🙇‍♂️', '🧠', '🏆',
    '😵‍💫', '🫡', '😆', '😤', '🤝', '🥳', '🧐', '💡', '📣', '🛠️'
];

export const CHAT_STICKER_PRESETS = [
    { id: 'wgs-cheer', label: '파이팅', token: '[STICKER:wgs-cheer]', icon: '💪', title: '파이팅!', message: '끝까지 가보자', accent: '#22c55e' },
    { id: 'wgs-like', label: '좋아요', token: '[STICKER:wgs-like]', icon: '👍', title: '좋아요!', message: '아주 좋습니다', accent: '#60a5fa' },
    { id: 'wgs-clap', label: '박수', token: '[STICKER:wgs-clap]', icon: '👏', title: '박수!', message: '멋집니다', accent: '#fbbf24' },
    { id: 'wgs-thanks', label: '감사', token: '[STICKER:wgs-thanks]', icon: '🙏', title: '감사합니다', message: '도움 고마워요', accent: '#a78bfa' },
    { id: 'wgs-ok', label: '확인', token: '[STICKER:wgs-ok]', icon: '✅', title: '확인 완료', message: '확인했습니다', accent: '#34d399' },
    { id: 'wgs-focus', label: '집중', token: '[STICKER:wgs-focus]', icon: '📚', title: '집중 모드', message: '공부 ON', accent: '#38bdf8' },
    { id: 'wgs-lucky', label: '합격기운', token: '[STICKER:wgs-lucky]', icon: '🍀', title: '합격 기운', message: '받아가세요', accent: '#4ade80' },
    { id: 'wgs-question', label: '질문', token: '[STICKER:wgs-question]', icon: '🤔', title: '질문 있어요', message: '잠깐 확인!', accent: '#fb7185' },
    { id: 'wgs-hi', label: '인사', token: '[STICKER:wgs-hi]', icon: '👋', title: '안녕하세요!', message: '반갑습니다', accent: '#38bdf8' },
    { id: 'wgs-solved', label: '해결', token: '[STICKER:wgs-solved]', icon: '💡', title: '해결!', message: '이제 이해됨', accent: '#f59e0b' },
    { id: 'wgs-rest', label: '휴식', token: '[STICKER:wgs-rest]', icon: '☕', title: '잠깐 쉬자', message: '충전도 필요해', accent: '#94a3b8' },
    { id: 'wgs-perfect', label: '완벽', token: '[STICKER:wgs-perfect]', icon: '🏆', title: '완벽합니다', message: '점수 가보자', accent: '#eab308' }
];

export const CHAT_GIF_PRESETS = [
    // motion 값으로 GIF풍 CSS 애니메이션을 구분합니다. 실제 gif 파일 없이도 손흔들기/박수 느낌을 낼 수 있습니다.
    { id: 'wgs-gif-wave', label: '인사 GIF', token: '[GIF:wgs-gif-wave]', icon: '👋', title: '안녕안녕!', message: '손 흔들며 인사', accent: '#38bdf8', motion: 'wave' },
    { id: 'wgs-gif-clap', label: '박수 GIF', token: '[GIF:wgs-gif-clap]', icon: '👏', title: '짝짝짝!', message: '응원 박수 발사', accent: '#fbbf24', motion: 'clap' },
    { id: 'wgs-gif-cheer', label: '파이팅 GIF', token: '[GIF:wgs-gif-cheer]', icon: '💪', title: '파이팅!', message: '끝까지 밀어붙이자', accent: '#22c55e', motion: 'pulse' },
    { id: 'wgs-gif-fire', label: '불타는 공부', token: '[GIF:wgs-gif-fire]', icon: '🔥', title: '불타는 공부', message: '집중력 상승 중', accent: '#fb7185', motion: 'fire' },
    { id: 'wgs-gif-code', label: '폭풍 코딩', token: '[GIF:wgs-gif-code]', icon: '⌨️', title: '폭풍 코딩', message: '타다다닥!', accent: '#60a5fa', motion: 'typing' },
    { id: 'wgs-gif-lucky', label: '합격 기원', token: '[GIF:wgs-gif-lucky]', icon: '🍀', title: '합격 기원', message: '좋은 기운 발사', accent: '#34d399', motion: 'float' },
    { id: 'wgs-gif-understand', label: '이해 완료', token: '[GIF:wgs-gif-understand]', icon: '🥲', title: '이해 완료', message: '드디어 알았다', accent: '#a78bfa', motion: 'pulse' },
    { id: 'wgs-gif-bug', label: '에러 발견', token: '[GIF:wgs-gif-bug]', icon: '🐛', title: '버그 발견', message: '원인을 찾아보자', accent: '#f97316', motion: 'crawl' },
    { id: 'wgs-gif-loading', label: '로딩 중', token: '[GIF:wgs-gif-loading]', icon: '⏳', title: '로딩 중', message: '잠깐만 기다려요', accent: '#94a3b8', motion: 'spin' },
    { id: 'wgs-gif-welcome', label: '대환영', token: '[GIF:wgs-gif-welcome]', icon: '🎊', title: '환영합니다!', message: '우공실 입장 완료', accent: '#ec4899', motion: 'confetti' },
    { id: 'wgs-gif-lightbulb', label: '깨달음 GIF', token: '[GIF:wgs-gif-lightbulb]', icon: '💡', title: '아하!', message: '머릿속 전구 ON', accent: '#facc15', motion: 'glow' },
    { id: 'wgs-gif-study', label: '공부 GIF', token: '[GIF:wgs-gif-study]', icon: '📚', title: '공부모드', message: '집중해서 한 문제 더', accent: '#818cf8', motion: 'bounce' }
];

// 토큰을 빠르게 찾기 위한 Map입니다.
// 메시지를 렌더링할 때 매번 배열 전체를 검색하지 않아도 됩니다.
export const CHAT_STICKER_BY_TOKEN = new Map(CHAT_STICKER_PRESETS.map((item) => [item.token, item]));
export const CHAT_GIF_BY_TOKEN = new Map(CHAT_GIF_PRESETS.map((item) => [item.token, item]));

// 채팅 본문에서 스티커/GIF 토큰만 안전하게 분리하기 위한 정규식입니다.
// 사용자가 일반 텍스트를 같이 입력해도 토큰 부분만 카드로 바꿉니다.
export const CHAT_RICH_TOKEN_REGEX = /(\[(?:STICKER|GIF):[a-z0-9_-]+\])/g;
export const CHAT_LEGACY_GIF_PREFIX = '[GIF]';
