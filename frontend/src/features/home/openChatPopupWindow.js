// Home page feature module for openChatPopupWindow.
import {
  CHAT_EMOJI_PRESETS,
  CHAT_GIF_PRESETS,
  CHAT_STICKER_PRESETS,
} from './chatPresets.js';

const escapePopupHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const escapePopupAttr = (value) => escapePopupHtml(value)
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function openChatPopupWindow({
  loggedInUser,
  setChatError,
  getChatVisibleSinceMs,
  apiBase = '',
  serverInstanceIdKey,
  chatCopy,
}) {
  const API_BASE = apiBase;
  const SERVER_INSTANCE_ID_KEY = serverInstanceIdKey;
  const {
    liveChatAutoLabel,
    liveChatInputPlaceholder,
    liveChatSendButtonLabel,
    liveChatEmptyMessage,
    chatPopupWindowTitle,
    chatPopupHeadingTitle,
    chatPopupCloseButtonLabel,
    chatPopupNotRefreshedLabel,
    chatPopupKeepNotice,
    chatPopupLoadingMessage,
    chatPopupToolTitle,
  } = chatCopy;

        const userId = sessionStorage.getItem('userId');
        const token = sessionStorage.getItem('sessionToken');
        const serverInstanceId = sessionStorage.getItem(SERVER_INSTANCE_ID_KEY) || localStorage.getItem(SERVER_INSTANCE_ID_KEY) || '';

        if (!loggedInUser || !userId || !token) {
            setChatError('로그인 후 팝업 채팅창을 사용할 수 있습니다.');
            return;
        }

        const visibleSinceMs = getChatVisibleSinceMs();
        const apiBaseForPopup = `${window.location.origin}${API_BASE}`;
        const popupName = 'ugongsil_realtime_chat_popup';
        const popupFeatures = 'width=760,height=720,left=120,top=80,resizable=yes,scrollbars=yes,status=no,menubar=no,toolbar=no,location=no';
        const popup = window.open('', popupName, popupFeatures);

        if (!popup) {
            setChatError('브라우저에서 팝업이 차단되었습니다. 팝업 허용 후 다시 눌러주세요.');
            return;
        }

        const popupHtml = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapePopupHtml(chatPopupWindowTitle)}</title>
<style>
    * { box-sizing: border-box; }
    body {
        margin: 0;
        min-height: 100vh;
        background: #0f172a;
        color: #f8fafc;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .wrap { min-height: 100vh; padding: 18px; background: linear-gradient(135deg, #0f172a, #111827); }
    .panel { min-height: calc(100vh - 36px); display: flex; flex-direction: column; gap: 12px; border: 2px solid rgba(16,185,129,.55); border-radius: 18px; padding: 18px; background: rgba(15,23,42,.86); box-shadow: 0 18px 45px rgba(0,0,0,.40); }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .title { margin: 0; color: #dbeafe; font-size: 22px; font-weight: 900; }
    .close { border: 0; border-radius: 10px; background: #334155; color: white; padding: 10px 14px; font-weight: 900; cursor: pointer; }
    .meta { color: #94a3b8; font-size: 13px; line-height: 1.55; }
    .messages { flex: 1; min-height: 300px; max-height: calc(100vh - 250px); overflow-y: auto; padding: 12px; border: 1px solid rgba(148,163,184,.28); border-radius: 14px; background: #020617; display: flex; flex-direction: column; gap: 10px; }
    .msg { border: 1px solid rgba(148,163,184,.22); border-radius: 13px; background: rgba(15,23,42,.72); padding: 11px 13px; word-break: break-word; }
    .msg.mine { border-color: rgba(16,185,129,.55); background: rgba(6,78,59,.34); }
    .msg-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 5px; }
    .msg-time { color: #93c5fd; font-size: 11px; font-weight: 800; }
    .msg-name { color: #f8fafc; font-size: 14px; font-weight: 900; }
    .msg.mine .msg-name { color: #6ee7b7; }
    .msg-me { color: #10b981; font-size: 11px; font-weight: 900; }
    .msg-text { color: #f8fafc; font-size: 15px; font-weight: 750; line-height: 1.55; }
    .empty, .error { text-align: center; color: #94a3b8; padding: 24px 8px; }
    .error { color: #fca5a5; }
    .picker { border: 1px solid rgba(148,163,184,.25); border-radius: 14px; padding: 10px; background: rgba(2,6,23,.62); }
    .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .tab, .emoji-btn, .send, .tool { cursor: pointer; }
    .tab { border: 1px solid rgba(148,163,184,.35); border-radius: 999px; padding: 8px 12px; background: rgba(15,23,42,.70); color: #cbd5e1; font-weight: 900; }
    .tab.active { border-color: rgba(16,185,129,.75); background: rgba(16,185,129,.20); color: #bbf7d0; }
    .emoji-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 42px)); gap: 8px; align-items: center; max-height: 130px; overflow-y: auto; overflow-x: hidden; }
    .emoji-btn { width: 42px; height: 42px; border: 1px solid rgba(148,163,184,.35); border-radius: 10px; background: #020617; color: white; font-size: 22px; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1; }
    .preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; max-height: 160px; overflow-y: auto; }
    .preset { text-align: left; border-radius: 13px; color: white; cursor: pointer; padding: 10px; font-size: 12px; line-height: 1.35; }
    /* 팝업 채팅도 본 화면과 동일하게 버튼/입력창 높이를 맞춥니다. */
    .composer { display: flex; gap: 8px; align-items: stretch; }
    .tool { width: 52px; min-width: 52px; height: 52px; border: 1px solid rgba(148,163,184,.35); border-radius: 12px; background: #020617; color: white; font-size: 20px; display:inline-flex; align-items:center; justify-content:center; padding:0; line-height:1; }
    .input { flex: 1; min-width: 0; height: 52px; border: 1px solid rgba(148,163,184,.35); border-radius: 12px; background: #020617; color: white; padding: 0 14px; font-size: 15px; }
    .send { min-width: 66px; height: 52px; border: 0; border-radius: 12px; background: #10b981; color: white; padding: 0 18px; font-size: 16px; font-weight: 900; display:inline-flex; align-items:center; justify-content:center; line-height:1; }
    .media-card { display: inline-flex; align-items: center; gap: 9px; max-width: 100%; margin: 4px 4px 4px 0; padding: 9px 12px; border-radius: 14px; vertical-align: middle; }
    .media-icon { display: inline-block; font-size: 28px; line-height: 1; animation: pop 1.2s ease-in-out infinite; }
    .gif-card { animation: bounce 1.15s ease-in-out infinite, glow 1.6s ease-in-out infinite; }
    @keyframes pop { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
    @keyframes bounce { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.035); } }
    @keyframes glow { 0%, 100% { box-shadow: 0 0 10px rgba(96,165,250,.20); } 50% { box-shadow: 0 0 24px rgba(16,185,129,.35); } }
    /* 팝업에서도 GIF 토큰별 애니메이션이 유지됩니다. */
    @keyframes wave { 0%,100% { transform: rotate(0deg); } 20% { transform: rotate(18deg); } 40% { transform: rotate(-12deg); } 60% { transform: rotate(16deg); } 80% { transform: rotate(-8deg); } }
    @keyframes clap { 0%,100% { transform: scale(1) rotate(0deg); } 50% { transform: scale(1.16) rotate(-8deg); } }
    @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.14); } }
    @keyframes fire { 0%,100% { transform: translateY(0) scale(1); filter: saturate(1); } 50% { transform: translateY(-4px) scale(1.08); filter: saturate(1.45); } }
    @keyframes typing { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
    @keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
    @keyframes crawl { 0%,100% { transform: translateX(0) rotate(0deg); } 50% { transform: translateX(5px) rotate(8deg); } }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes confetti { 0%,100% { transform: translateY(0) rotate(0deg) scale(1); } 50% { transform: translateY(-5px) rotate(12deg) scale(1.1); } }
    @keyframes glowIcon { 0%,100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(250,204,21,0)); } 50% { transform: scale(1.12); filter: drop-shadow(0 0 8px rgba(250,204,21,.85)); } }
    .motion-wave { animation: wave 1.05s ease-in-out infinite !important; transform-origin: 70% 70%; }
    .motion-clap { animation: clap .68s ease-in-out infinite !important; }
    .motion-pulse { animation: pulse .92s ease-in-out infinite !important; }
    .motion-fire { animation: fire .84s ease-in-out infinite !important; }
    .motion-typing { animation: typing .34s linear infinite !important; }
    .motion-float { animation: floaty 1.15s ease-in-out infinite !important; }
    .motion-crawl { animation: crawl 1.1s ease-in-out infinite !important; }
    .motion-spin { animation: spin 1.05s linear infinite !important; }
    .motion-confetti { animation: confetti .92s ease-in-out infinite !important; }
    .motion-glow { animation: glowIcon 1.05s ease-in-out infinite !important; }
</style>
</head>
<body>
<div class="wrap">
    <main class="panel">
        <div class="head">
            <h1 class="title">${escapePopupHtml(chatPopupHeadingTitle)}</h1>
            <button class="close" id="closeBtn">${escapePopupHtml(chatPopupCloseButtonLabel)}</button>
        </div>
        <div class="meta">
            ${escapePopupHtml(liveChatAutoLabel)} <span id="refreshedAt">${escapePopupHtml(chatPopupNotRefreshedLabel)}</span><br />
            ${escapePopupHtml(chatPopupKeepNotice)}
        </div>
        <div class="messages" id="messages"><div class="empty">${escapePopupHtml(chatPopupLoadingMessage)}</div></div>
        <div class="picker" id="picker" style="display:none;">
            <div class="tabs">
                <button class="tab active" data-tab="emoji">이모지</button>
                <button class="tab" data-tab="sticker">스티커</button>
                <button class="tab" data-tab="gif">GIF</button>
            </div>
            <div id="pickerBody"></div>
        </div>
        <div class="composer">
            <button class="tool" id="pickerBtn" title="${escapePopupAttr(chatPopupToolTitle)}">😊</button>
            <input class="input" id="input" maxlength="500" placeholder="${escapePopupAttr(liveChatInputPlaceholder)}" />
            <button class="send" id="sendBtn">${escapePopupHtml(liveChatSendButtonLabel)}</button>
        </div>
    </main>
</div>
<script>
(function(){
    var apiBase = ${JSON.stringify(apiBaseForPopup)};
    var userId = ${JSON.stringify(userId)};
    var token = ${JSON.stringify(token)};
    var serverInstanceId = ${JSON.stringify(serverInstanceId)};
    var visibleSinceMs = ${JSON.stringify(visibleSinceMs)};
    var emojiPresets = ${JSON.stringify(CHAT_EMOJI_PRESETS)};
    var stickerPresets = ${JSON.stringify(CHAT_STICKER_PRESETS)};
    var gifPresets = ${JSON.stringify(CHAT_GIF_PRESETS)};
    var stickerByToken = {};
    var gifByToken = {};
    stickerPresets.forEach(function(item){ stickerByToken[item.token] = item; });
    gifPresets.forEach(function(item){ gifByToken[item.token] = item; });
    var currentTab = 'emoji';
    var messagesEl = document.getElementById('messages');
    var inputEl = document.getElementById('input');
    var pickerEl = document.getElementById('picker');
    var pickerBodyEl = document.getElementById('pickerBody');
    var refreshedAtEl = document.getElementById('refreshedAt');

    function pad(n){ return String(n).padStart(2, '0'); }
    function localTime(value){
        var d = value ? new Date(value) : new Date();
        if (isNaN(d.getTime())) d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    function escapeHtml(value){
        return String(value || '').replace(/[&<>"']/g, function(ch){
            return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch];
        });
    }
    function mediaHtml(item, isGif){
        var accent = item.accent || '#60a5fa';
        var motion = isGif ? ' motion-' + (item.motion || 'bounce') : '';
        return '<span class="media-card ' + (isGif ? 'gif-card' : '') + '" style="border:1px solid ' + accent + '88;background:linear-gradient(135deg,' + accent + '26,rgba(15,23,42,.86));">'
            + '<span class="media-icon' + motion + '">' + escapeHtml(item.icon) + '</span>'
            + '<span><strong style="display:block;color:white;font-size:13px;white-space:nowrap;">' + escapeHtml(item.title) + '</strong>'
            + '<span style="display:block;color:#cbd5e1;font-size:11px;white-space:nowrap;">' + escapeHtml(item.message) + '</span></span></span>';
    }
    function renderRich(text){
        var raw = String(text || '');
        var regex = new RegExp('(\\[(?:STICKER|GIF):[a-z0-9_-]+\\])', 'g');
        var parts = raw.split(regex).filter(Boolean);
        return parts.map(function(part){
            if (stickerByToken[part]) return mediaHtml(stickerByToken[part], false);
            if (gifByToken[part]) return mediaHtml(gifByToken[part], true);
            if (part.trim().indexOf('[GIF]') === 0) {
                return mediaHtml({ icon:'✨', title:'GIF 문구', message:part.replace('[GIF]', '').trim() || '움직이는 응원 메시지', accent:'#60a5fa' }, true);
            }
            return '<span style="white-space:pre-wrap;">' + escapeHtml(part) + '</span>';
        }).join('');
    }
    function renderMessages(list){
        if (!Array.isArray(list) || list.length === 0) {
            messagesEl.innerHTML = '<div class="empty">${escapePopupHtml(liveChatEmptyMessage)}</div>';
            return;
        }
        messagesEl.innerHTML = list.map(function(msg){
            var mine = String(msg.userId) === String(userId);
            return '<div class="msg ' + (mine ? 'mine' : '') + '">'
                + '<div class="msg-head"><span class="msg-time">' + localTime(msg.createdAt) + '</span>'
                + '<span class="msg-name">' + escapeHtml(msg.userName || msg.userId) + '</span>'
                + (mine ? '<span class="msg-me">(나)</span>' : '') + '</div>'
                + '<div class="msg-text">' + renderRich(msg.text) + '</div></div>';
        }).join('');
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    async function refresh(){
        try {
            var res = await fetch(apiBase + '/api/realtime-chat/list', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id:userId, sessionToken:token, serverInstanceId:serverInstanceId, sinceMs:visibleSinceMs })
            });
            var data = await res.json();
            if (data.serverInstanceId) serverInstanceId = data.serverInstanceId;
            if (data.valid === false) {
                messagesEl.innerHTML = '<div class="error">세션이 만료되었습니다. 사이트에서 다시 로그인해주세요.</div>';
                return;
            }
            if (data.success) {
                renderMessages(data.messages || []);
                refreshedAtEl.textContent = localTime();
            } else {
                messagesEl.innerHTML = '<div class="error">' + escapeHtml(data.msg || '채팅을 불러오지 못했습니다.') + '</div>';
            }
        } catch(e) {
            messagesEl.innerHTML = '<div class="error">서버 연결 문제로 채팅을 불러오지 못했습니다.</div>';
        }
    }
    async function send(){
        var text = inputEl.value.trim();
        if (!text) return;
        inputEl.value = '';
        try {
            var res = await fetch(apiBase + '/api/realtime-chat/send', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id:userId, sessionToken:token, serverInstanceId:serverInstanceId, text:text, sinceMs:visibleSinceMs })
            });
            var data = await res.json();
            if (data.serverInstanceId) serverInstanceId = data.serverInstanceId;
            if (data.success) {
                renderMessages(data.messages || []);
                refreshedAtEl.textContent = localTime();
            } else {
                messagesEl.innerHTML = '<div class="error">' + escapeHtml(data.msg || '채팅 전송에 실패했습니다.') + '</div>';
            }
        } catch(e) {
            messagesEl.innerHTML = '<div class="error">서버 연결 문제로 채팅을 전송하지 못했습니다.</div>';
        }
    }
    function appendToken(tokenText){
        var base = inputEl.value.trimEnd();
        inputEl.value = base ? base + ' ' + tokenText : tokenText;
        inputEl.focus();
    }
    function renderPicker(){
        document.querySelectorAll('.tab').forEach(function(btn){ btn.classList.toggle('active', btn.dataset.tab === currentTab); });
        if (currentTab === 'emoji') {
            pickerBodyEl.innerHTML = '<div class="emoji-grid">' + emojiPresets.map(function(e){ return '<button class="emoji-btn" data-token="' + escapeHtml(e) + '">' + escapeHtml(e) + '</button>'; }).join('') + '</div>';
        } else {
            var list = currentTab === 'sticker' ? stickerPresets : gifPresets;
            pickerBodyEl.innerHTML = '<div class="preset-grid">' + list.map(function(item){
                var accent = item.accent || '#60a5fa';
                var motion = currentTab === 'gif' ? ' motion-' + (item.motion || 'bounce') : '';
                return '<button class="preset ' + (currentTab === 'gif' ? 'gif-card' : '') + '" data-token="' + escapeHtml(item.token) + '" style="border:1px solid ' + accent + '88;background:linear-gradient(135deg,' + accent + '26,rgba(15,23,42,.86));">'
                    + '<span class="media-icon' + motion + '">' + escapeHtml(item.icon) + '</span> <strong>' + escapeHtml(item.title) + '</strong><br><span style="color:#cbd5e1;">' + escapeHtml(item.message) + '</span></button>';
            }).join('') + '</div>';
        }
    }
    document.getElementById('closeBtn').addEventListener('click', function(){ window.close(); });
    document.getElementById('sendBtn').addEventListener('click', send);
    inputEl.addEventListener('keydown', function(e){ if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    document.getElementById('pickerBtn').addEventListener('click', function(){ pickerEl.style.display = pickerEl.style.display === 'none' ? 'block' : 'none'; renderPicker(); });
    document.querySelectorAll('.tab').forEach(function(btn){ btn.addEventListener('click', function(){ currentTab = btn.dataset.tab; renderPicker(); }); });
    pickerBodyEl.addEventListener('click', function(e){ var btn = e.target.closest('[data-token]'); if (btn) appendToken(btn.dataset.token); });
    renderPicker();
    refresh();
    setInterval(refresh, 3000);
})();
</script>
</body>
</html>`;

        popup.document.open();
        popup.document.write(popupHtml);
        popup.document.close();
        popup.focus();
    
}
