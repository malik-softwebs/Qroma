// Initialize Supabase & Libs
lucide.createIcons();
const supabaseUrl = 'https://uggbbvvbckxyffrxusdx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZ2JidnZiY2t4eWZmcnh1c2R4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MTU4OTYsImV4cCI6MjA4OTI5MTg5Nn0.c38aC8rsYqMaKGpGP0rgBkfC-wDxPMiJMISFig-OL18';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
const REDIRECT_URL = 'https://qroma.netlify.app/chat.html';

// Global State
let currentUser = null, userProfile = null, userPreferences = null, personalities = [];
let currentConversationId = null, attachedImageFile = null, activePersonalityId = 'default';
let streamController = null;

// ======================= THEME & FONT ENGINE =======================
const appThemes = {
    Signature: { p: '#834DFB', s: '#F8F7FF', sec: '#E5DDFF', d: '#18102B' },
    Midnight: { p: '#A78BFA', s: '#0F0916', sec: '#2D1B4E', d: '#F3E8FF', dark: true },
    Noir: { p: '#E5E5E5', s: '#000000', sec: '#1A1A1A', d: '#FFFFFF', dark: true },
    Ocean: { p: '#0284C7', s: '#F0F9FF', sec: '#E0F2FE', d: '#0C4A6E' },
    Forest: { p: '#059669', s: '#F0FDF4', sec: '#DCFCE7', d: '#064E3B' },
    Burgundy: { p: '#E11D48', s: '#FFF1F2', sec: '#FFE4E6', d: '#881337' },
    Dune: { p: '#D97706', s: '#FFFBEB', sec: '#FEF3C7', d: '#78350F' }
};

const builtInFonts = ['Inter', 'Plus Jakarta Sans', 'Work Sans', 'Coolvetica', 'Poppins', 'Playfair Display'];

const applyTheme = (themeName = 'Signature') => {
    const t = appThemes[themeName] || appThemes.Signature;
    const root = document.documentElement.style;
    root.setProperty('--md-sys-color-primary', t.p); root.setProperty('--md-sys-color-surface', t.s);
    root.setProperty('--md-sys-color-secondary', t.sec); root.setProperty('--md-sys-color-dark', t.d);
    document.body.style.color = t.dark ? '#FFFFFF' : '#1C1B1F';
    document.getElementById('hljs-theme-dark').disabled = !t.dark; document.getElementById('hljs-theme-light').disabled = !!t.dark;
};

const loadAndApplyFont = (fontName, fontUrl = null) => {
    if (!fontName || fontName === 'Coolvetica') { document.getElementById('main-container').style.fontFamily = fontName === 'Coolvetica' ? '"Coolvetica", sans-serif' : ''; return; }
    const fontId = `font-${fontName.replace(/\s/g, '-')}`;
    if (!document.getElementById(fontId)) {
        const link = document.createElement('link'); link.id = fontId; link.rel = 'stylesheet';
        link.href = fontUrl || `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`;
        document.head.appendChild(link);
    }
    document.getElementById('main-container').style.fontFamily = `"${fontName}", sans-serif`;
};

// ======================= UTILITIES & EXPOSED ACTIONS =======================
const fileToBase64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result); reader.onerror = reject; });
const formatTime = (dateStr) => { const d = dateStr ? new Date(dateStr) : new Date(); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

window.toggleSidebar = () => { document.getElementById('chat-sidebar')?.classList.toggle('open'); document.getElementById('ui-overlay')?.classList.toggle('active'); };
window.closeOverlays = () => { document.querySelectorAll('.sidebar.open, #ui-overlay.active').forEach(el => el.classList.remove('open', 'active')); document.getElementById('settings-sheet')?.style.setProperty('transform', 'translateY(100%)'); document.getElementById('rename-modal')?.classList.add('hidden'); };
window.showScreen = (screenId) => { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(screenId)?.classList.add('active'); };
window.showRenameModal = (id, currentTitle) => { const modal = document.getElementById('rename-modal'); modal.classList.remove('hidden'); modal.classList.add('flex'); document.getElementById('rename-input').value = currentTitle; document.getElementById('confirm-rename').dataset.id = id; };
window.pinConversation = async (id, isPinned) => await supabaseClient.from('conversations').update({ is_pinned: !isPinned }).eq('id', id).then(loadConversations);
window.confirmRename = async () => { const id = document.getElementById('confirm-rename').dataset.id; const newTitle = document.getElementById('rename-input').value.trim(); if (newTitle) await supabaseClient.from('conversations').update({ title: newTitle }).eq('id', id).then(loadConversations); window.closeOverlays(); };
window.deleteConversation = async (id) => { if (confirm('Delete this chat forever?')) await supabaseClient.from('conversations').delete().eq('id', id).then(() => { if (currentConversationId === id) { currentConversationId = null; document.getElementById('messages-container').innerHTML = ''; document.getElementById('empty-state').classList.remove('hidden'); } loadConversations(); }); };
window.deletePersonality = async (id) => { if (confirm('Delete this personality?')) await supabaseClient.from('personalities').delete().eq('id', id).then(checkSessionAndRoute); };
window.copyMessageContent = (el) => { const content = el.closest('.message-ai').querySelector('.content').innerText; navigator.clipboard.writeText(content); alert('Copied!'); };
window.regenerateLastResponse = async () => { if (!currentConversationId) return; const { data } = await supabaseClient.from('messages').select('id, content').eq('conversation_id', currentConversationId).eq('role', 'user').order('created_at', { ascending: false }).limit(1); if (data && data.length > 0) { const lastUserMessageId = data[0].id; await supabaseClient.from('messages').delete().eq('conversation_id', currentConversationId).gt('id', lastUserMessageId); document.getElementById('msg-input').value = data[0].content; document.getElementById('send-btn').click(); } };

setInterval(() => { const clock = document.getElementById('header-clock'); if (clock) clock.innerText = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }); }, 1000);

// ======================= CORE DATA ROUTING =======================
// Replace your existing checkSessionAndRoute in script.js with this:
const checkSessionAndRoute = async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;
    const isIndex = !!document.getElementById('screen-auth');

    if (currentUser) {
        // Explicitly fetch the profile to see if onboarding was completed
        const { data: profile, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();
        
        userProfile = profile;

        if (!profile) {
            // User exists but has no profile record: Show Onboarding
            if (isIndex) {
                document.getElementById('onboarding-modal')?.classList.replace('hidden', 'flex');
            } else {
                // If they somehow reached chat.html without a profile, send them back to onboard
                window.location.href = 'index.html';
            }
        } else {
            // Profile exists: Proceed to Chat
            if (isIndex) {
                window.location.href = 'chat.html';
            } else {
                // Standard chat initialization
                const { data: prefs } = await supabaseClient.from('user_preferences').select('*').eq('id', currentUser.id).single();
                userPreferences = prefs || {};
                const { data: perso } = await supabaseClient.from('personalities').select('*').eq('user_id', currentUser.id);
                personalities = perso || [];
                applyTheme(profile?.theme);
                loadAndApplyFont(userPreferences.custom_font || 'Inter', userPreferences.custom_font_url);
                populatePersonalitiesSwitcher();
                loadConversations();
            }
        }
    } else if (!isIndex) {
        window.location.href = 'index.html';
    }
};


// ======================= MESSAGE RENDERING (FIXED HTML & MATH) =======================
const postProcessMessage = (element) => {
    element.querySelectorAll('.math-inline').forEach(el => katex.render(el.textContent, el, { throwOnError: false, displayMode: false }));
    element.querySelectorAll('.math-display').forEach(el => katex.render(el.textContent, el, { throwOnError: false, displayMode: true }));
    element.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
};

function renderMessage(role, content, messageId, timestamp = null) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    let existingMessage = document.querySelector(`[data-id="${messageId}"]`);
    
    let formattedContent = '';
    if (content) {
        // Pure marked parse (handles HTML escaping correctly natively via marked options if configured, but default works well for highlighting)
        formattedContent = marked.parse(content, { breaks: true, gfm: true });
        // Inject math classes
        formattedContent = formattedContent.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math-display">$1</div>').replace(/\$([^$\n]+?)\$/g, '<span class="math-inline">$1</span>');
    }
    
    const timeDisplay = formatTime(timestamp);

    if (existingMessage) {
        existingMessage.querySelector('.content').innerHTML = formattedContent;
    } else {
        const div = document.createElement('div');
        div.dataset.id = messageId;
        if (role === 'user') {
            div.className = 'flex justify-end';
            div.innerHTML = `<div class="flex flex-col items-end"><div class="bubble-user max-w-[90%] p-4 text-[17px] leading-relaxed shadow-sm">${formattedContent}</div><span class="timestamp mt-1 pr-1">${timeDisplay}</span></div>`;
        } else {
            div.className = 'message-ai w-full pb-4'; 
            div.innerHTML = `
                <div class="ai-avatar shrink-0 shadow-md">Q</div>
                <div class="content-wrapper">
                    <div class="content text-[17px] leading-relaxed">${content === null ? '<div class="pulsing-loader animate-pulse font-bold text-xl text-gray-400">...</div>' : formattedContent}</div>
                    <div class="msg-meta">
                        <span class="timestamp">${timeDisplay}</span>
                        <div class="message-actions">
                            <button onclick="window.copyMessageContent(this)"><i data-lucide="copy" class="w-4 h-4"></i></button>
                            <button onclick="window.regenerateLastResponse()"><i data-lucide="refresh-cw" class="w-4 h-4"></i></button>
                        </div>
                    </div>
                </div>`;
        }
        container.appendChild(div);
        existingMessage = div;
    }
    
    postProcessMessage(existingMessage);
    lucide.createIcons();
    container.scrollTop = container.scrollHeight;
    return existingMessage;
}

async function loadMessages() {
    if (!currentConversationId) return;
    document.getElementById('empty-state')?.classList.add('hidden');
    const container = document.getElementById('messages-container');
    if (!container) return;
    container.innerHTML = '';
    const { data } = await supabaseClient.from('messages').select('*').eq('conversation_id', currentConversationId).order('created_at', { ascending: true });
    if (data) data.forEach(m => renderMessage(m.role, m.content, m.id, m.created_at));
}

async function loadConversations() {
    if (!currentUser) return; 
    const { data } = await supabaseClient.from('conversations').select('*').eq('user_id', currentUser.id).order('is_pinned', { ascending: false }).order('updated_at', { ascending: false });
    const list = document.getElementById('conversations-list');
    if (!list) return;
    list.innerHTML = '';
    
    if ((!data || data.length === 0) && currentConversationId === null) { document.getElementById('empty-state')?.classList.remove('hidden'); return; }
    if (!currentConversationId && data && data.length > 0) { currentConversationId = data[0].id; loadMessages(); }
    
    (data || []).forEach(c => {
        const div = document.createElement('div');
        div.className = `convo-item p-3 rounded-xl flex items-center gap-3 cursor-pointer transition-colors`;
        const activeClass = appThemes[userProfile?.theme]?.dark ? 'bg-white/10 text-white' : 'bg-[#F0E6FF]';
        if (c.id === currentConversationId) div.classList.add(...activeClass.split(' ')); else div.classList.add('hover:bg-gray-100');
        div.innerHTML = `
            ${c.is_pinned ? '<i data-lucide="pin" class="w-4 h-4 text-qroma shrink-0"></i>' : '<i data-lucide="message-square" class="w-4 h-4 text-gray-400 shrink-0"></i>'}
            <div class="flex-1 truncate font-medium text-sm">${c.title}</div>
            <div class="convo-actions">
                <button class="p-1 text-gray-400 hover:text-gray-800"><i data-lucide="more-vertical" class="w-4 h-4"></i></button>
                <div class="dropdown">
                    <button onclick="window.pinConversation('${c.id}', ${c.is_pinned})"><i data-lucide="pin" class="w-4 h-4"></i> ${c.is_pinned ? 'Unpin' : 'Pin'}</button>
                    <button onclick="window.showRenameModal('${c.id}', '${c.title.replace(/'/g, "\\'")}')"><i data-lucide="file-pen-line" class="w-4 h-4"></i> Rename</button>
                    <button onclick="window.deleteConversation('${c.id}')" class="text-red-500"><i data-lucide="trash-2" class="w-4 h-4"></i> Delete</button>
                </div>
            </div>`;
        div.onclick = (e) => { if (!e.target.closest('.convo-actions')) { currentConversationId = c.id; loadMessages(); window.closeOverlays(); loadConversations(); } };
        list.appendChild(div);
    });
    lucide.createIcons();
}

// ======================= SETTINGS & PERSONALITIES =======================
const populatePersonalitiesSwitcher = () => { const switcher = document.getElementById('personality-switcher'); if (!switcher) return; switcher.innerHTML = `<option value="default">Default AI</option>` + personalities.map(p => `<option value="${p.id}">${p.name}</option>`).join(''); switcher.value = activePersonalityId; };
const renderPersonalitiesInSettings = () => { const list = document.getElementById('personalities-list'); if (!list) return; list.innerHTML = personalities.map(p => `<div class="bg-white p-3 rounded-lg border border-gray-100 flex justify-between items-center text-sm shadow-sm"><span class="font-bold text-gray-700 truncate">${p.name}</span><button onclick="window.deletePersonality('${p.id}')" class="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>`).join('') || '<p class="text-xs text-gray-400 font-medium">No custom personas created yet.</p>'; lucide.createIcons(); };

// ======================= EVENT LISTENERS =======================
window.addEventListener('DOMContentLoaded', () => {
    checkSessionAndRoute();
    
    if (document.getElementById('screen-auth')) {
        document.getElementById('auth-btn').addEventListener('click', async () => { const email = document.getElementById('email-input').value, password = document.getElementById('pwd-input').value, msg = document.getElementById('auth-msg'); msg.innerText = "Processing..."; let { error } = await supabaseClient.auth.signInWithPassword({ email, password }); if (error) { const { error: signUpError } = await supabaseClient.auth.signUp({ email, password }); if (signUpError) { msg.innerText = signUpError.message; return; }} msg.innerText = "Success!"; checkSessionAndRoute(); });
        document.getElementById('google-btn').onclick = () => supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: REDIRECT_URL }});
        document.getElementById('github-btn').onclick = () => supabaseClient.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: REDIRECT_URL }});
        document.getElementById('ob-submit').onclick = async () => { const name = document.getElementById('ob-name').value; const theme = document.querySelector('.theme-btn.bg-\\[\\#834DFB\\]')?.dataset.theme || 'Signature'; if (!name || !document.getElementById('ob-age').checked) return alert("Please enter name and confirm age."); await supabaseClient.from('profiles').insert({ id: currentUser.id, username: name, theme }); window.location.href = 'chat.html'; };
        document.querySelectorAll('.theme-btn').forEach(btn => btn.onclick = e => { document.querySelectorAll('.theme-btn').forEach(b => b.classList.replace('bg-[#834DFB]', 'bg-gray-200') || b.classList.replace('text-white', 'text-black')); e.target.classList.replace('bg-gray-200', 'bg-[#834DFB]'); e.target.classList.add('text-white'); });
    }

    if (document.getElementById('chat-area')) {
        const msgInput = document.getElementById('msg-input');
        msgInput.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 150) + 'px'; });

        document.getElementById('menu-btn').onclick = window.toggleSidebar; 
        document.getElementById('logout-btn').onclick = async () => { await supabaseClient.auth.signOut(); window.location.href = 'index.html'; };
        
        document.getElementById('new-chat-btn').onclick = () => { 
            currentConversationId = null; 
            document.getElementById('messages-container').innerHTML = ''; 
            document.getElementById('empty-state').classList.remove('hidden'); 
            loadConversations(); 
            window.closeOverlays(); 
        };
        
        document.getElementById('attach-btn').onclick = () => document.getElementById('file-input')?.click();
        document.getElementById('file-input').onchange = e => { if (e.target.files.length) { attachedImageFile = e.target.files[0]; document.getElementById('image-preview')?.classList.remove('hidden'); } };
        document.getElementById('rm-img').onclick = () => { attachedImageFile = null; document.getElementById('file-input').value = ""; document.getElementById('image-preview')?.classList.add('hidden'); };
        document.getElementById('personality-switcher').onchange = (e) => activePersonalityId = e.target.value;
        document.getElementById('stop-generating-btn').onclick = () => { if(streamController) streamController.abort(); };

        document.getElementById('settings-btn').onclick = () => {
            window.closeOverlays();
            document.getElementById('set-name').value = userProfile?.username || '';
            const themeSelect = document.getElementById('set-theme'); themeSelect.innerHTML = Object.keys(appThemes).map(t => `<option value="${t}">${t}</option>`).join(''); themeSelect.value = userProfile?.theme || 'Signature';
            
            const fontContainer = document.getElementById('font-pills-container'); fontContainer.innerHTML = ''; 
            builtInFonts.forEach(font => { 
                const p = document.createElement('button'); p.className = 'font-pill'; p.textContent = font; p.dataset.font = font; p.style.fontFamily = font; 
                if ((userPreferences?.custom_font || 'Inter') === font) p.classList.add('active'); 
                p.onclick = () => { fontContainer.querySelectorAll('.font-pill').forEach(el => el.classList.remove('active')); p.classList.add('active'); }; 
                fontContainer.appendChild(p); 
            });
            
            document.getElementById('set-font-url').value = userPreferences?.custom_font_url || ''; 
            document.getElementById('set-custom-prompt').value = userPreferences?.custom_prompt || '';
            renderPersonalitiesInSettings();
            
            if (userProfile?.is_paid) { document.getElementById('pro-badge')?.classList.remove('hidden'); document.getElementById('get-pro-btn')?.classList.add('hidden'); }
            setTimeout(() => document.getElementById('settings-sheet').style.transform = 'translateY(0)', 100);
        };
        
        document.querySelectorAll('.tab-btn').forEach(btn => btn.onclick = (e) => { document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active', 'text-qroma', 'border-b-2', 'border-qroma'); b.classList.add('text-gray-400'); }); e.target.classList.add('active', 'text-qroma', 'border-b-2', 'border-qroma'); e.target.classList.remove('text-gray-400'); document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden')); document.getElementById(`tab-${e.target.dataset.tab}`).classList.remove('hidden'); });
        
        document.getElementById('set-font-url').onkeyup = async (e) => { if (e.key === 'Enter' && userProfile?.is_paid) { const url = e.target.value.trim(); if (!url) return; const match = url.match(/family=([^&:]+)/); if (match) { const fontName = decodeURIComponent(match[1].replace(/\+/g, ' ')); loadAndApplyFont(fontName, url); if (!builtInFonts.includes(fontName)) builtInFonts.push(fontName); document.getElementById('settings-btn').click(); } else alert("Invalid Google Font URL format."); } };
        
        document.getElementById('save-settings-btn').onclick = async () => {
            const btn = document.getElementById('save-settings-btn'); btn.innerText = "Saving...";
            const newName = document.getElementById('set-name').value, newTheme = document.getElementById('set-theme').value, newFontUrl = document.getElementById('set-font-url').value.trim(), newFontName = document.querySelector('.font-pill.active')?.dataset.font || 'Inter', customSys = document.getElementById('set-custom-prompt').value.trim();
            const newPName = document.getElementById('new-personality-name').value.trim(), newPPrompt = document.getElementById('new-personality-prompt').value.trim();
            
            if (!userProfile?.is_paid && (newFontUrl || customSys || personalities.length >= 3)) return alert("Custom Fonts, Prompts, and >3 Personas are Pro features!");
            
            await supabaseClient.from('profiles').update({ username: newName, theme: newTheme }).eq('id', currentUser.id);
            await supabaseClient.from('user_preferences').upsert({ id: currentUser.id, custom_font: newFontName, custom_font_url: newFontUrl, custom_prompt: customSys });
            if (newPName && newPPrompt) { await supabaseClient.from('personalities').insert({ user_id: currentUser.id, name: newPName, prompt: newPPrompt }); document.getElementById('new-personality-name').value = ''; document.getElementById('new-personality-prompt').value = ''; }
            
            await checkSessionAndRoute(); btn.innerText = "Save"; window.closeOverlays();
        };

        document.getElementById('get-pro-btn').onclick = () => {
            const text = encodeURIComponent(`Hi! I'd like to get Qroma Pro.\nName: ${userProfile?.username}\nEmail: ${currentUser?.email}\nUser ID: ${currentUser?.id}`);
            window.open(`https://wa.me/923437335632?text=${text}`, '_blank');
        };
        
        // STREAMING SEND LOGIC
        document.getElementById('send-btn').onclick = async () => {
            const text = msgInput.value.trim(); if (!text && !attachedImageFile) return;
            msgInput.value = ''; msgInput.style.height = 'auto'; let uploadedImgUrl = null, localBlobUrl = null;

            if (!currentConversationId) {
                const { data } = await supabaseClient.from('conversations').insert({ user_id: currentUser.id, title: text.substring(0,25) || 'New Chat' }).select().single();
                if (!data) return alert("DB Error."); currentConversationId = data.id; document.getElementById('empty-state')?.classList.add('hidden'); await loadConversations();
            }

            if (attachedImageFile) { if ((userProfile.images_used_today || 0) >= 5 && !userProfile.is_paid) return alert("Image limit reached! Upgrade to Pro."); localBlobUrl = URL.createObjectURL(attachedImageFile); const fileName = `${currentUser.id}/${Date.now()}`; const { data } = await supabaseClient.storage.from('chat-images').upload(fileName, attachedImageFile); uploadedImgUrl = data ? supabaseClient.storage.from('chat-images').getPublicUrl(data.path).data.publicUrl : null; await supabaseClient.from('profiles').update({ images_used_today: (userProfile.images_used_today || 0) + 1 }).eq('id', currentUser.id); }

            renderMessage('user', text, 'temp-user');
            const aiMessageElement = renderMessage('assistant', null, 'temp-ai');
            const currentImgFile = attachedImageFile; attachedImageFile = null; document.getElementById('image-preview')?.classList.add('hidden'); document.getElementById('file-input').value = "";
            
            streamController = new AbortController();
            document.getElementById('stop-generating-btn').classList.remove('hidden');
            
            try {
                const { data: history } = await supabaseClient.from('messages').select('role, content').eq('conversation_id', currentConversationId).order('created_at', { ascending: false }).limit(15);
                let messagesPayload = (history || []).reverse().map(m => ({ role: m.role, content: m.content }));
                
                const activePersonality = personalities.find(p => p.id === activePersonalityId);
                let sysPrompt = `You are Qroma, an AI assistant.\nToday is ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}.\nUser name: ${userProfile?.username || 'User'}.\nUser is ${userProfile?.is_paid ? 'paid' : 'free'} user.\nCurrent theme: ${userProfile?.theme || 'Signature'}.\nBe helpful, concise, and friendly.`;
                
                if (activePersonality) sysPrompt += `\n\n[PERSONA INSTRUCTIONS]\n${activePersonality.prompt}`;
                if (userProfile?.is_paid && userPreferences?.custom_prompt) sysPrompt += `\n\n[USER CUSTOM INSTRUCTIONS]\n${userPreferences.custom_prompt}`;
                
                messagesPayload.unshift({ role: 'system', content: sysPrompt });

                let model = 'llama-3.3-70b-versatile'; 
                if (currentImgFile) {
                    model = 'meta-llama/llama-4-scout-17b-16e-instruct'; 
                    messagesPayload.push({ role: 'user', content: [{ type: "text", text: text || "Analyze this image." }, { type: "image_url", image_url: { url: await fileToBase64(currentImgFile) } }] });
                } else {
                    messagesPayload.push({ role: 'user', content: text });
                }

                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer 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`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: messagesPayload, stream: true }), signal: streamController.signal });
                if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || "API Failed"); }
                
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let fullResponse = "", buffer = "";
                
                while(true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); 
                    
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;
                        if (trimmedLine.startsWith('data: ')) {
                            try {
                                const parsed = JSON.parse(trimmedLine.slice(6));
                                const delta = parsed.choices[0]?.delta?.content || "";
                                fullResponse += delta;
                                let html = marked.parse(fullResponse, { breaks: true });
                                html = html.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math-display">$1</div>').replace(/\$([^$]+?)\$/g, '<span class="math-inline">$1</span>');
                                aiMessageElement.querySelector('.content').innerHTML = html;
                            } catch(e) {} 
                        }
                    }
                }
                
                postProcessMessage(aiMessageElement);
                await supabaseClient.rpc('insert_message_pair', { p_conversation_id: currentConversationId, p_user_id: currentUser.id, p_user_content: text || '[Image Sent]', p_assistant_content: fullResponse, p_model: model, p_image_url: uploadedImgUrl });
                document.querySelector('[data-id="temp-user"]')?.remove();
                aiMessageElement.remove();
                await loadMessages();

            } catch (error) { 
                if (error.name !== 'AbortError') { aiMessageElement.querySelector('.content').innerHTML = `<p class="text-red-500 font-bold">Error: ${error.message}</p>`; console.error(error); }
            } finally { document.getElementById('stop-generating-btn').classList.add('hidden'); streamController = null; }
        };
    }
});
