const $ = s => document.querySelector(s), app = $('#app');
let me = null, token = localStorage.getItem('t') || '', tagF = '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const nm = u => (u.tag ? `<b class="tag">[${esc(u.tag)}]</b> ` : '') + `<span class="user">${esc(u.username)}</span>`;
const who = u => `<a href="#/u/${encodeURIComponent(u.username)}">${nm(u)}</a>`; // name + tag, links to profile
const date = d => new Date(d).toLocaleString();
const act = async f => { try { await f(); } catch (e) { alert(e.message); } };
const setToken = t => { token = t || ''; t ? localStorage.setItem('t', t) : localStorage.removeItem('t'); };
const rank = u => ({ user: 0, staff: 1, senior: 2, owner: 3 })[u?.role] ?? 0;
const can = p => rank(me) >= 2 || (rank(me) === 1 && (me.perms || []).includes(p));
// Escapes text first, then turns http(s) links into clickable ones
const links = s => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`);
const setTag = t => { tagF = t; if (['', '#/'].includes(location.hash)) route(); };

async function api(a, body, qs = '') {
  const r = await fetch(`/api?a=${a}${qs}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token) { setToken(''); me = null; nav(); }
    throw new Error(j.error || 'Something went wrong');
  }
  return j;
}

// Renders html, then wires each <form id> to handlers[id](data, form).
// A form locks while it submits (no double clicks). A handler that returns true
// is navigating away, so its form stays locked until the next page replaces it.
function page(html, handlers = {}) {
  app.innerHTML = html;
  app.querySelectorAll('form').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    if (f.dataset.busy) return;
    f.dataset.busy = 1;
    const btns = f.querySelectorAll('button'); btns.forEach(b => b.disabled = true);
    const m = f.querySelector('.msg'); if (m) m.textContent = '';
    let keep = false;
    try { keep = (await handlers[f.id](Object.fromEntries(new FormData(f)), f)) === true; }
    catch (x) { m ? m.textContent = x.message : alert(x.message); }
    finally { if (!keep) { delete f.dataset.busy; btns.forEach(b => b.disabled = false); } }
  });
}

function nav() {
  $('#nav').innerHTML = '<a href="#/news">News</a><a href="#/rules">Rules</a>' + (me
    ? `<a href="#/up">Upload</a>${rank(me) ? '<a href="#/reports">Reports</a><a href="#/mod">Staff panel</a>' : ''}<a href="#/u/${encodeURIComponent(me.username)}">${nm(me)}</a><a href="#/set">Settings</a><a href="#" onclick="logout();return false">Log out</a>`
    : '<a href="#/login">Log in or sign up</a>');
  const b = $('#ban'); b.hidden = !me?.ban;
  if (me?.ban) b.textContent = `Your account is banned until ${date(me.ban.until)}. Reason: ${me.ban.reason}. You can browse, but not upload, like or comment.`;
}
async function boot() {
  me = null;
  if (token) try { const j = await api('me'); me = { ...j.user, ban: j.ban }; } catch {}
  nav();
}
function logout() { setToken(''); me = null; nav(); location.hash === '#/' ? route() : (location.hash = '#/'); }
const needLogin = () => !me && (location.hash = '#/login', true);

// ---------- images, videos and canvas helpers ----------
const jpeg = (src, sw, sh, w, h, sx = 0, sy = 0) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return c.toDataURL('image/jpeg', .85);
};
const fit = (src, w, h, max) => { const s = Math.min(1, max / Math.max(w, h)); return jpeg(src, w, h, Math.round(w * s), Math.round(h * s)); };
const loadImg = f => new Promise((ok, no) => {
  const im = new Image(), u = URL.createObjectURL(f);
  im.onload = () => { URL.revokeObjectURL(u); ok(im); };
  im.onerror = () => { URL.revokeObjectURL(u); no(new Error('That file is not a readable image')); };
  im.src = u;
});
// Re-encodes to JPEG (max 1600px): keeps uploads small and strips EXIF/location data
const shrink = async f => { const im = await loadImg(f); return fit(im, im.naturalWidth, im.naturalHeight, 1600); };
const avatarOf = async f => { const im = await loadImg(f), s = Math.min(im.naturalWidth, im.naturalHeight); return jpeg(im, s, s, 256, 256, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2); };

// Video limits: change MAXV (seconds) or MAXB (bytes) here
const MAXV = 15 * 60, MAXB = 50 * 1024 * 1024;
const vtype = f => ({ mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' })[f.name.split('.').pop().toLowerCase()] || f.type;
// Checks the video's length and grabs a thumbnail frame
const probe = f => new Promise((ok, no) => {
  const v = document.createElement('video'), u = URL.createObjectURL(f);
  const done = (fn, x) => { clearTimeout(t); URL.revokeObjectURL(u); fn(x); };
  const bad = m => done(no, new Error(m || 'This browser cannot read that video. Try an MP4 (H.264) file.'));
  const t = setTimeout(() => bad(), 15000);
  v.muted = true; v.playsInline = true; v.preload = 'metadata';
  v.onerror = () => bad();
  v.onloadedmetadata = () => {
    if (!isFinite(v.duration)) return bad('Could not read the length of that video. Try exporting it as an MP4.');
    if (v.duration > MAXV) return bad(`Videos must be ${MAXV / 60} minutes or shorter.`);
    if (!v.videoWidth) return bad();
    v.currentTime = Math.min(1, v.duration / 2);
  };
  v.onseeked = () => done(ok, fit(v, v.videoWidth, v.videoHeight, 1280));
  v.src = u;
});
// Uploads straight to Supabase (Vercel can't accept large files) and reports progress
const putFile = (url, file, onp) => new Promise((ok, no) => {
  const x = new XMLHttpRequest(), fd = new FormData();
  fd.append('cacheControl', '3600'); fd.append('', file);
  x.open('PUT', url);
  x.upload.onprogress = e => e.lengthComputable && onp(Math.round(e.loaded / e.total * 100));
  x.onload = () => {
    if (x.status < 300) return ok();
    let m = ''; try { m = JSON.parse(x.responseText).message; } catch {}
    no(new Error('Video upload failed' + (m ? ': ' + m : ` (${x.status})`)));
  };
  x.onerror = () => no(new Error('Video upload failed. Check your connection.'));
  x.send(fd);
});

// ---------- reporting ----------
// type = 'post' | 'comment' | 'user'. The reporter only has to type a reason.
function report(type, id) {
  if (needLogin()) return;
  const d = document.createElement('dialog');
  d.innerHTML = `<form class="box"><h3>Report this ${type}</h3>
    <textarea name="reason" maxlength="500" placeholder="Why are you reporting this?" required></textarea>
    <div class="actions"><button>Send report</button><button type="button" class="ghost">Cancel</button></div><span class="msg"></span></form>`;
  document.body.appendChild(d);
  const f = d.querySelector('form'), m = f.querySelector('.msg'), [send, cancel] = f.querySelectorAll('button');
  cancel.onclick = () => d.close();
  d.onclose = () => d.remove();
  f.onsubmit = async e => {
    e.preventDefault(); send.disabled = true; m.textContent = '';
    try { await api('report', { type, id, reason: f.reason.value }); d.close(); alert('Report sent. Thank you.'); }
    catch (x) { m.textContent = x.message; send.disabled = false; }
  };
  d.showModal();
}

// ---------- feed, post page, upload ----------
const card = (i, extra = '') => `<div class="card">${i.kind === 'video' ? '<span class="vid">Video</span>' : ''}<a href="#/i/${i.id}"><img loading="lazy" src="${esc(i.url)}" alt=""></a>
  <h3><a href="#/i/${i.id}">${esc(i.title)}</a></h3>
  <p>${who(i.user)}<br>${i.likes} likes, ${i.comments} comments${i.tags.length ? '<br>' + i.tags.map(t => esc(t)).join(', ') : ''}</p>${extra}</div>`;
const pager = (p, pages, base) => pages > 1 ? `<div class="pager">${p > 1 ? `<a href="${base}${p - 1}">Previous</a>` : ''}<span>Page ${p} of ${pages}</span>${p < pages ? `<a href="${base}${p + 1}">Next</a>` : ''}</div>` : '';

async function feed(p = 1) {
  const qs = `&page=${p}&tag=${encodeURIComponent(tagF)}&q=${encodeURIComponent($('#q').value)}`;
  const [{ images, pages }, { tags }] = await Promise.all([api('feed', null, qs), api('tags')]);
  page(`<div class="chips"><a href="#/" onclick="setTag('')" class="${tagF ? '' : 'on'}">All</a>${tags.map(t => `<a href="#/" onclick="setTag('${esc(t)}')" class="${t === tagF ? 'on' : ''}">${esc(t)}</a>`).join('')}</div>
    <div class="grid">${images.map(i => card(i)).join('') || '<p>No posts found.</p>'}</div>${pager(p, pages, '#/page/')}`);
}

async function view(id) {
  const { image: i, comments } = await api('image', null, '&id=' + encodeURIComponent(id));
  const tg = i.tags.map(t => `<a href="#/" onclick="setTag('${esc(t)}')">${esc(t)}</a>`).join(' ');
  const media = i.kind === 'video' && i.video
    ? `<video controls preload="metadata" playsinline poster="${esc(i.url)}" src="${esc(i.video)}"></video>`
    : `<img src="${esc(i.url)}" alt="${esc(i.title)}">`;
  const cmtActs = c => [
    me?.id !== c.user_id ? `<a href="#" onclick="report('comment','${c.id}');return false">Report</a>` : '',
    me && (me.id === c.user_id || can('cmt')) ? `<a href="#" onclick="delCmt('${c.id}');return false">Delete comment</a>` : '',
  ].filter(Boolean).join(' &nbsp; ');
  page(`<article class="view">${media}<h2>${esc(i.title)}</h2>
    <p>${who(i.user)} <small>${date(i.created_at)}</small></p><p>${tg}</p><p class="pre">${esc(i.descr)}</p>
    <div class="actions"><button class="${i.liked ? 'on' : ''}" onclick="like('${i.id}')">${i.liked ? 'Liked' : 'Like'} (${i.likes})</button>
    ${me?.id !== i.owner ? `<button class="ghost" onclick="report('post','${i.id}')">Report</button>` : ''}
    ${me && (me.id === i.owner || can('img')) ? `<button class="danger" onclick="delImg('${i.id}')">Delete ${i.kind}</button>` : ''}</div></article>
    <section><h3>${comments.length} comments</h3>
    ${me ? '<form id="cm" class="box"><textarea name="body" maxlength="500" placeholder="Add a comment" required></textarea><button>Post comment</button><span class="msg"></span></form>' : '<p><a href="#/login">Log in</a> to like or comment.</p>'}
    ${comments.map(c => `<div class="cmt"><div>${who(c.users)} <small>${date(c.created_at)}</small></div><p class="pre">${esc(c.body)}</p>${cmtActs(c)}</div>`).join('')}</section>`,
    { cm: async d => { await api('comment', { id: i.id, body: d.body }); await view(id); } });
}
const like = id => act(async () => { if (needLogin()) return; await api('like', { id }); route(); });
const delImg = id => confirm('Delete this post?') && act(async () => { await api('delimage', { id }); location.hash = '#/'; });
const delCmt = id => confirm('Delete this comment?') && act(async () => { await api('delcomment', { id }); route(); });

async function upload() {
  if (needLogin()) return;
  const { tags } = await api('tags');
  page(`<h2>Upload</h2><form id="up" class="box"><input name="title" placeholder="Title" maxlength="100" required>
    <textarea name="descr" placeholder="Description (optional)" maxlength="1000"></textarea>
    <div class="chips">${tags.map(t => `<label><input type="checkbox" name="tags" value="${esc(t)}"> ${esc(t)}</label>`).join('')}</div>
    <input name="newtags" placeholder="Add tags, separated by commas (5 max)" maxlength="100">
    <input type="file" id="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" required>
    <small>Images are resized automatically. Videos can be up to ${MAXV / 60} minutes and ${MAXB / 1048576} MB (MP4 works best).</small>
    <small>Please follow the <a href="#/rules">rules</a>: no reuploads, no stolen work, correct tags, no AI imagery or videos.</small>
    <button>Upload</button><small id="st"></small><span class="msg"></span></form>`,
    { up: async (d, f) => {
      const file = $('#file').files[0], st = $('#st');
      if (!file) throw new Error('Choose an image or a video');
      const sel = [...f.querySelectorAll('[name=tags]:checked')].map(c => c.value);
      const typed = (d.newtags || '').split(/[,\s]+/).map(t => t.replace(/^#/, '').toLowerCase()).filter(Boolean);
      const body = { title: d.title, descr: d.descr, tags: [...new Set([...sel, ...typed])].slice(0, 5) };
      try {
        if (file.type.startsWith('video/') || vtype(file).startsWith('video/')) {
          if (file.size > MAXB) throw new Error(`That video is over ${MAXB / 1048576} MB. Compress or trim it and try again.`);
          const vf = new File([file], file.name, { type: vtype(file) });
          st.textContent = 'Checking video...';
          body.data = await probe(vf);
          const { path, signedUrl } = await api('signvideo', { type: vf.type });
          await putFile(signedUrl, vf, n => st.textContent = `Uploading video... ${n}%`);
          body.video = path;
        } else body.data = await shrink(file);
        st.textContent = 'Publishing...';
        const r = await api('upload', body);
        location.hash = '#/i/' + r.id;
        return true; // stay locked until the new page replaces this form
      } catch (e) { st.textContent = ''; throw e; }
    } });
}

// ---------- profiles ----------
async function profile(name, tab, n) {
  const { user: u } = await api('profile', null, '&name=' + encodeURIComponent(decodeURIComponent(name || '')));
  const posts = tab === 'posts', p = posts ? n : 1, base = '#/u/' + encodeURIComponent(u.username);
  const { images, total, pages } = await api('feed', null, `&uid=${u.id}&page=${p}`);
  const own = me?.id === u.id, clear = me && can('img') && rank(me) > rank(u);
  page(`<div class="profile">${u.avatarUrl ? `<img class="avatar" src="${esc(u.avatarUrl)}" alt="">` : `<div class="avatar ph">${esc(u.username[0].toUpperCase())}</div>`}
    <div><h2>${nm(u)}</h2><small>Joined ${new Date(u.created_at).toLocaleDateString()}</small></div>
    ${!own ? `<button class="ghost" onclick="report('user','${u.id}')">Report user</button>` : ''}</div>
    <div class="tabs"><button class="${posts ? '' : 'on'}" onclick="location.hash='${base}'">About</button><button class="${posts ? 'on' : ''}" onclick="location.hash='${base}/posts'">Posts (${total})</button></div>
    ${posts
      ? `<div class="grid">${images.map(i => card(i)).join('') || '<p>No posts yet.</p>'}</div>${pager(p, pages, base + '/posts/')}`
      : `<p class="pre">${esc(u.bio) || '<small>No description yet.</small>'}</p>${own ? '<p><a href="#/set">Edit your profile</a></p>' : ''}${clear ? `<button class="danger" onclick="clearProf('${u.id}','${esc(u.username)}')">Clear bio and picture</button>` : ''}`}`);
}
const clearProf = (id, name) => confirm(`Clear ${name}'s bio and profile picture?`) && act(async () => { await api('clearprofile', { id }); route(); });

// ---------- accounts ----------
async function enter(a, d) { setToken((await api(a, d)).token); await boot(); location.hash = '#/'; return true; }
function auth() {
  page(`<div class="two"><form id="login" class="box"><h2>Log in</h2><input name="login" placeholder="Username or email" required>
    <input name="password" type="password" placeholder="Password" required><button>Log in</button><span class="msg"></span></form>
    <form id="reg" class="box"><h2>Create an account</h2><input name="username" placeholder="Username" required>
    <input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password (8+ characters)" minlength="8" required>
    <button>Create account</button><span class="msg"></span></form></div>`,
    { login: d => enter('login', d), reg: d => enter('register', d) });
}

function settings() {
  if (needLogin()) return;
  page(`<h2>Account settings</h2><p>Signed in as ${who(me)} (${esc(me.email)})</p>
    <form id="pf" class="box"><h3>Profile</h3><textarea name="bio" maxlength="300" placeholder="Describe yourself (300 characters max)">${esc(me.bio)}</textarea>
    <label>Profile picture <input type="file" id="av" accept="image/*"></label><button>Save profile</button><span class="msg"></span></form>
    <form id="em" class="box"><h3>Change email</h3><input name="email" type="email" placeholder="New email" required>
    <input name="password" type="password" placeholder="Current password" required><button>Save email</button><span class="msg"></span></form>
    <form id="pw" class="box"><h3>Change password</h3><input name="old" type="password" placeholder="Current password" required>
    <input name="new" type="password" placeholder="New password (8+ characters)" minlength="8" required>
    <button>Change password</button><span class="msg"></span></form>
    <form id="out" class="box"><h3>Security</h3><p>Sign out on every device. Use this if you think someone else has access.</p><button>Sign out everywhere</button></form>
    <form id="del" class="box"><h3>Delete account</h3><p>Permanently removes your account, posts, likes and comments.</p>
    <input name="password" type="password" placeholder="Password" required><button class="danger">Delete my account</button><span class="msg"></span></form>`,
    {
      pf: async d => {
        const file = $('#av').files[0];
        await api('saveprofile', { bio: d.bio, avatar: file ? await avatarOf(file) : undefined });
        me.bio = d.bio.trim(); alert('Profile saved');
      },
      em: async d => { await api('changeemail', d); me.email = d.email.toLowerCase(); settings(); },
      pw: async (d, f) => { setToken((await api('changepw', d)).token); f.reset(); alert('Password changed. Other devices were signed out.'); },
      out: async () => { await api('logoutall', {}); setToken(''); await boot(); location.hash = '#/login'; return true; },
      del: async d => { if (!confirm('Delete your account forever?')) return; await api('deleteacct', d); setToken(''); await boot(); location.hash = '#/'; return true; },
    });
}

// ---------- staff: reports and panel ----------
async function reportsPage() {
  if (!rank(me)) { location.hash = '#/'; return; }
  const { reports } = await api('reports');
  const base = location.origin + location.pathname;
  page(`<h2>Reports</h2><p><a href="#/mod">Back to the staff panel</a></p>
    ${reports.map(r => `<div class="cmt"><div>${r.reported ? who(r.reported) : 'A deleted user'} was reported by ${r.reporter ? who(r.reporter) : 'a deleted user'} <small>${date(r.created_at)}</small></div>
      <p class="pre"><b>Reason:</b> ${esc(r.reason)}</p>
      ${r.excerpt ? `<p class="pre"><b>Comment:</b> ${esc(r.excerpt)}</p>` : ''}
      <p><b>Link:</b> <a href="${esc(r.link)}">${esc(base + r.link)}</a></p>
      <button class="ghost" onclick="dismiss('${r.id}')">Dismiss report</button></div>`).join('') || '<p>No reports right now.</p>'}`);
}
const dismiss = id => act(async () => { await api('dismissreport', { id }); reportsPage(); });

async function modPanel(q = '') {
  if (!rank(me)) { location.hash = '#/'; return; }
  const [{ users }, { images }, { tags }] = await Promise.all([api('users', null, '&q=' + encodeURIComponent(q)), api('feed'), api('tags')]);
  const sr = rank(me) >= 2, P = [['img', 'Delete posts'], ['cmt', 'Delete comments'], ['ban', 'Ban'], ['news', 'Post news']];
  page(`<h2>Staff panel</h2><p><a href="#/reports">View reports</a></p>
    ${sr ? `<form id="tg" class="row"><input name="name" placeholder="New post tag" maxlength="20"><button>Create tag</button><span class="msg"></span></form>
    <p>${tags.map(t => `${esc(t)} <a href="#" onclick="mod('deltag',{name:'${esc(t)}'});return false">remove</a>`).join(' &nbsp; ') || 'No tags yet'}</p>` : ''}
    <form id="us" class="row"><input name="q" value="${esc(q)}" placeholder="Search usernames"><button>Search</button></form>
    <div class="scroll"><table><tr><th>User</th><th>Status</th><th>Manage</th></tr>${users.map(u => {
      const id = u.id, low = rank(u) < rank(me), b = u.ban_until && new Date(u.ban_until) > new Date();
      return `<tr><td>${who(u)}<br><small>${u.role}</small></td>
      <td>${b ? `Banned until ${date(u.ban_until)}<br>${esc(u.ban_reason)}${low && can('ban') ? `<br><button onclick="mod('unban',{id:'${id}'})">Unban</button>` : ''}` : 'Active'}</td>
      <td>${!low ? '-' : `${can('ban') ? `<select id="d-${id}"><option value="1">1 hour</option><option value="24">1 day</option><option value="168">7 days</option><option value="720">30 days</option><option value="876000">Permanent</option></select> <input id="r-${id}" placeholder="Reason (required)" maxlength="200"> <button class="danger" onclick="mod('ban',{id:'${id}',hours:$('#d-${id}').value,reason:$('#r-${id}').value})">Ban</button><br>` : ''}
      ${sr ? `<input id="t-${id}" value="${esc(u.tag || '')}" maxlength="12" size="10"> <button onclick="mod('settag',{id:'${id}',tag:$('#t-${id}').value})">Save tag</button><br>` : ''}
      ${sr && u.role === 'staff' ? `${P.map(([k, n]) => `<label><input type="checkbox" class="p-${id}" value="${k}" ${(u.perms || []).includes(k) ? 'checked' : ''}> ${n}</label>`).join(' ')} <button onclick="mod('setperms',{id:'${id}',perms:[...document.querySelectorAll('.p-${id}:checked')].map(c => c.value)})">Save permissions</button><br>` : ''}
      ${rank(me) === 3 ? `<select id="o-${id}">${['user', 'staff', 'senior'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select> <button onclick="mod('setrole',{id:'${id}',role:$('#o-${id}').value})">Set role</button>` : ''}`}</td></tr>`;
    }).join('')}</table></div>
    ${can('img') ? `<h3>Recent posts</h3><div class="grid">${images.map(i => card(i, `<button class="danger" onclick="mod('delimage',{id:'${i.id}'})">Delete ${i.kind}</button>`)).join('')}</div>` : ''}`,
    { us: d => modPanel(d.q), tg: async d => { await api('addtag', { name: d.name }); await modPanel(); } });
}
const mod = (a, b) => (!['delimage', 'deltag'].includes(a) || confirm('Are you sure?')) && act(async () => { await api(a, b); modPanel(); });

// ---------- news and rules ----------
async function newsPage() {
  const { news } = await api('news');
  page(`<h2>News</h2>${me && can('news') ? '<form id="nw" class="box"><textarea name="body" maxlength="2000" placeholder="Write an announcement. Links like https://example.com become clickable." required></textarea><button>Post announcement</button><span class="msg"></span></form>' : ''}
    ${news.map(n => `<div class="cmt"><div>${who(n.users)} <small>${date(n.created_at)}</small></div><p class="pre">${links(n.body)}</p>${me && can('news') && (me.id === n.user_id || rank(me) >= 2) ? `<a href="#" onclick="delNews('${n.id}');return false">Delete</a>` : ''}</div>`).join('') || '<p>No announcements yet.</p>'}`,
    { nw: async d => { await api('addnews', { body: d.body }); await newsPage(); } });
}
const delNews = id => confirm('Delete this announcement?') && act(async () => { await api('delnews', { id }); route(); });

function rules() {
  page(`<div class="rules"><h2>Rules</h2>
    <ol><li>No reuploading</li><li>No stealing</li><li>Use correct tags</li><li>No AI imagery or videos</li><li>Don't be rude in the comments</li></ol>
    <p>Breaking these rules can get your posts removed or your account banned. If you see something that breaks them, use the Report button on the post, comment or profile.</p></div>`);
}

// ---------- router ----------
// #/u/name = profile, #/u/name/posts/2 = that user's posts (page 2)
const routes = { '': () => feed(1), page: id => feed(+id || 1), i: view, u: (name, tab, n) => profile(name, tab, +n || 1), up: upload, login: auth, set: settings, mod: () => modPanel(), reports: reportsPage, news: newsPage, rules };
async function route() {
  const [, p = '', id, tab, n] = location.hash.slice(1).split('/');
  try { await (Object.hasOwn(routes, p) ? routes[p] : routes[''])(id, tab, n); }
  catch (e) { app.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}
addEventListener('hashchange', route);
$('#q').onchange = () => location.hash.length > 2 ? (location.hash = '#/') : route();
boot().then(route);
