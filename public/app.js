const $ = s => document.querySelector(s), app = $('#app');
let me = null, token = localStorage.getItem('t') || '', tagF = '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const who = u => (u.tag ? `<b class="tag">[${esc(u.tag)}]</b> ` : '') + `<span>${esc(u.username)}</span>`;
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

// Renders html, then wires each <form id> to handlers[id](data, form)
function page(html, handlers = {}) {
  app.innerHTML = html;
  app.querySelectorAll('form').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const m = f.querySelector('.msg'); if (m) m.textContent = '';
    try { await handlers[f.id](Object.fromEntries(new FormData(f)), f); }
    catch (x) { m ? m.textContent = x.message : alert(x.message); }
  });
}

function nav() {
  $('#nav').innerHTML = '<a href="#/news">News</a>' + (me
    ? `<a href="#/up">Upload</a>${rank(me) ? '<a href="#/mod">Staff panel</a>' : ''}<a href="#/set">${who(me)}</a><a href="#" onclick="logout();return false">Log out</a>`
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

// ---------- feed, image page, upload ----------
async function feed(p = 1) {
  const qs = `&page=${p}&tag=${encodeURIComponent(tagF)}&q=${encodeURIComponent($('#q').value)}`;
  const [{ images, pages }, { tags }] = await Promise.all([api('feed', null, qs), api('tags')]);
  const pager = pages > 1 ? `<div class="pager">${p > 1 ? `<a href="#/page/${p - 1}">Previous</a>` : ''}<span>Page ${p} of ${pages}</span>${p < pages ? `<a href="#/page/${p + 1}">Next</a>` : ''}</div>` : '';
  page(`<div class="chips"><a href="#/" onclick="setTag('')" class="${tagF ? '' : 'on'}">All</a>${tags.map(t => `<a href="#/" onclick="setTag('${esc(t)}')" class="${t === tagF ? 'on' : ''}">${esc(t)}</a>`).join('')}</div>
    <div class="grid">${images.map(i => `<a class="card" href="#/i/${i.id}"><img loading="lazy" src="${esc(i.url)}" alt=""><h3>${esc(i.title)}</h3><p>${who(i.user)}<br>${i.likes} likes, ${i.comments} comments<br>${i.tags.map(t => '#' + esc(t)).join(' ')}</p></a>`).join('') || '<p>No images found.</p>'}</div>${pager}`);
}

async function view(id) {
  const { image: i, comments } = await api('image', null, '&id=' + encodeURIComponent(id));
  const tg = i.tags.map(t => `<a href="#/" onclick="setTag('${esc(t)}')">#${esc(t)}</a>`).join(' ');
  page(`<article class="view"><img src="${esc(i.url)}" alt="${esc(i.title)}"><h2>${esc(i.title)}</h2>
    <p>${who(i.user)} <small>${date(i.created_at)}</small></p><p>${tg}</p><p class="pre">${esc(i.descr)}</p>
    <button class="${i.liked ? 'on' : ''}" onclick="like('${i.id}')">${i.liked ? 'Liked' : 'Like'} (${i.likes})</button>
    ${me && (me.id === i.owner || can('img')) ? `<button class="danger" onclick="delImg('${i.id}')">Delete image</button>` : ''}</article>
    <section><h3>${comments.length} comments</h3>
    ${me ? '<form id="cm" class="box"><textarea name="body" maxlength="500" placeholder="Add a comment" required></textarea><button>Post comment</button><span class="msg"></span></form>' : '<p><a href="#/login">Log in</a> to like or comment.</p>'}
    ${comments.map(c => `<div class="cmt"><div>${who(c.users)} <small>${date(c.created_at)}</small></div><p class="pre">${esc(c.body)}</p>${me && (me.id === c.user_id || can('cmt')) ? `<a href="#" onclick="delCmt('${c.id}');return false">Delete comment</a>` : ''}</div>`).join('')}</section>`,
    { cm: async d => { await api('comment', { id: i.id, body: d.body }); view(id); } });
}
const like = id => act(async () => { if (needLogin()) return; await api('like', { id }); route(); });
const delImg = id => confirm('Delete this image?') && act(async () => { await api('delimage', { id }); location.hash = '#/'; });
const delCmt = id => confirm('Delete this comment?') && act(async () => { await api('delcomment', { id }); route(); });

// Re-encodes to JPEG (max 1600px): keeps uploads small and strips EXIF/location data
const shrink = f => new Promise((ok, no) => {
  const im = new Image();
  im.onload = () => {
    const s = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
    c.width = im.width * s; c.height = im.height * s;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    ok(c.toDataURL('image/jpeg', .85));
  };
  im.onerror = () => no(new Error('That file is not a readable image'));
  im.src = URL.createObjectURL(f);
});

async function upload() {
  if (needLogin()) return;
  const { tags } = await api('tags');
  page(`<h2>Upload an image</h2><form id="up" class="box"><input name="title" placeholder="Title" maxlength="100" required>
    <textarea name="descr" placeholder="Description (optional)" maxlength="1000"></textarea>
    <div class="chips">${tags.map(t => `<label><input type="checkbox" name="tags" value="${esc(t)}"> ${esc(t)}</label>`).join('') || '<small>No tags available yet.</small>'}</div>
    <input type="file" id="file" accept="image/*" required><button>Upload image</button><span class="msg"></span></form>`,
    { up: async (d, f) => {
      const file = $('#file').files[0]; if (!file) throw new Error('Choose an image');
      const sel = [...f.querySelectorAll('[name=tags]:checked')].map(c => c.value);
      const r = await api('upload', { title: d.title, descr: d.descr, tags: sel, data: await shrink(file) });
      location.hash = '#/i/' + r.id;
    } });
}

// ---------- accounts ----------
async function enter(a, d) { setToken((await api(a, d)).token); await boot(); location.hash = '#/'; }
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
    <form id="em" class="box"><h3>Change email</h3><input name="email" type="email" placeholder="New email" required>
    <input name="password" type="password" placeholder="Current password" required><button>Save email</button><span class="msg"></span></form>
    <form id="pw" class="box"><h3>Change password</h3><input name="old" type="password" placeholder="Current password" required>
    <input name="new" type="password" placeholder="New password (8+ characters)" minlength="8" required>
    <button>Change password</button><span class="msg"></span></form>
    <form id="out" class="box"><h3>Security</h3><p>Sign out on every device. Use this if you think someone else has access.</p><button>Sign out everywhere</button></form>
    <form id="del" class="box"><h3>Delete account</h3><p>Permanently removes your account, images, likes and comments.</p>
    <input name="password" type="password" placeholder="Password" required><button class="danger">Delete my account</button><span class="msg"></span></form>`,
    {
      em: async d => { await api('changeemail', d); me.email = d.email.toLowerCase(); settings(); },
      pw: async (d, f) => { setToken((await api('changepw', d)).token); f.reset(); alert('Password changed. Other devices were signed out.'); },
      out: async () => { await api('logoutall', {}); setToken(''); await boot(); location.hash = '#/login'; },
      del: async d => { if (!confirm('Delete your account forever?')) return; await api('deleteacct', d); setToken(''); await boot(); location.hash = '#/'; },
    });
}

// ---------- staff panel ----------
async function modPanel(q = '') {
  if (!rank(me)) { location.hash = '#/'; return; }
  const [{ users }, { images }, { tags }] = await Promise.all([api('users', null, '&q=' + encodeURIComponent(q)), api('feed'), api('tags')]);
  const sr = rank(me) >= 2, P = [['img', 'Delete images'], ['cmt', 'Delete comments'], ['ban', 'Ban'], ['news', 'Post news']];
  page(`<h2>Staff panel</h2>
    ${sr ? `<form id="tg" class="row"><input name="name" placeholder="New post tag" maxlength="20"><button>Create tag</button><span class="msg"></span></form>
    <p>${tags.map(t => `#${esc(t)} <a href="#" onclick="mod('deltag',{name:'${esc(t)}'});return false">remove</a>`).join(' &nbsp; ') || 'No tags yet'}</p>` : ''}
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
    ${can('img') ? `<h3>Recent images</h3><div class="grid">${images.map(i => `<div class="card"><a href="#/i/${i.id}"><img src="${esc(i.url)}" alt=""></a><h3>${esc(i.title)}</h3><p>${who(i.user)}</p><button class="danger" onclick="mod('delimage',{id:'${i.id}'})">Delete image</button></div>`).join('')}</div>` : ''}`,
    { us: d => modPanel(d.q), tg: async d => { await api('addtag', { name: d.name }); modPanel(); } });
}
const mod = (a, b) => (!['delimage', 'deltag'].includes(a) || confirm('Are you sure?')) && act(async () => { await api(a, b); modPanel(); });

// ---------- news ----------
async function newsPage() {
  const { news } = await api('news');
  page(`<h2>News</h2>${me && can('news') ? '<form id="nw" class="box"><textarea name="body" maxlength="2000" placeholder="Write an announcement. Links like https://example.com become clickable." required></textarea><button>Post announcement</button><span class="msg"></span></form>' : ''}
    ${news.map(n => `<div class="cmt"><div>${who(n.users)} <small>${date(n.created_at)}</small></div><p class="pre">${links(n.body)}</p>${me && can('news') && (me.id === n.user_id || rank(me) >= 2) ? `<a href="#" onclick="delNews('${n.id}');return false">Delete</a>` : ''}</div>`).join('') || '<p>No announcements yet.</p>'}`,
    { nw: async d => { await api('addnews', { body: d.body }); newsPage(); } });
}
const delNews = id => confirm('Delete this announcement?') && act(async () => { await api('delnews', { id }); route(); });

// ---------- router ----------
const routes = { '': () => feed(1), page: id => feed(+id || 1), i: view, up: upload, login: auth, set: settings, mod: () => modPanel(), news: newsPage };
async function route() {
  const [, p = '', id] = location.hash.slice(1).split('/');
  try { await (Object.hasOwn(routes, p) ? routes[p] : feed)(id); }
  catch (e) { app.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}
addEventListener('hashchange', route);
$('#q').onchange = () => location.hash.length > 2 ? (location.hash = '#/') : route();
boot().then(route);
