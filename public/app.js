const $ = s => document.querySelector(s), app = $('#app');
let me = null, token = localStorage.getItem('t') || '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const who = u => (u.tag ? `<b class="tag">[${esc(u.tag)}]</b> ` : '') + `<span>${esc(u.username)}</span>`;
const date = d => new Date(d).toLocaleString();
const act = async f => { try { await f(); } catch (e) { alert(e.message); } };
const setToken = t => { token = t || ''; t ? localStorage.setItem('t', t) : localStorage.removeItem('t'); };

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
  $('#nav').innerHTML = me
    ? `<a href="#/up">Upload</a>${me.role === 'mod' ? '<a href="#/mod">Mod panel</a>' : ''}<a href="#/set">${who(me)}</a><a href="#" onclick="logout();return false">Log out</a>`
    : '<a href="#/login">Log in or sign up</a>';
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

// ---------- views ----------
async function feed() {
  const { images } = await api('feed', null, '&q=' + encodeURIComponent($('#q').value));
  page(`<div class="grid">${images.map(i => `<a class="card" href="#/i/${i.id}"><img loading="lazy" src="${esc(i.url)}" alt=""><h3>${esc(i.title)}</h3><p>${who(i.user)}<br>${i.likes} likes, ${i.comments} comments</p></a>`).join('') || '<p>No images yet. Be the first to upload one.</p>'}</div>`);
}

async function view(id) {
  const { image: i, comments } = await api('image', null, '&id=' + encodeURIComponent(id));
  const mod = me?.role === 'mod';
  page(`<article class="view"><img src="${esc(i.url)}" alt="${esc(i.title)}"><h2>${esc(i.title)}</h2>
    <p>${who(i.user)} <small>${date(i.created_at)}</small></p><p class="pre">${esc(i.descr)}</p>
    <button class="${i.liked ? 'on' : ''}" onclick="like('${i.id}')">${i.liked ? 'Liked' : 'Like'} (${i.likes})</button>
    ${me && (me.id === i.owner || mod) ? `<button class="danger" onclick="delImg('${i.id}')">Delete image</button>` : ''}</article>
    <section><h3>${comments.length} comments</h3>
    ${me ? '<form id="cm" class="box"><textarea name="body" maxlength="500" placeholder="Add a comment" required></textarea><button>Post comment</button><span class="msg"></span></form>' : '<p><a href="#/login">Log in</a> to like or comment.</p>'}
    ${comments.map(c => `<div class="cmt"><div>${who(c.users)} <small>${date(c.created_at)}</small></div><p class="pre">${esc(c.body)}</p>${me && (me.id === c.user_id || mod) ? `<a href="#" onclick="delCmt('${c.id}');return false">Delete comment</a>` : ''}</div>`).join('')}</section>`,
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

function upload() {
  if (needLogin()) return;
  page(`<h2>Upload an image</h2><form id="up" class="box"><input name="title" placeholder="Title" maxlength="100" required>
    <textarea name="descr" placeholder="Description (optional)" maxlength="1000"></textarea>
    <input type="file" id="file" accept="image/*" required><button>Upload image</button><span class="msg"></span></form>`,
    { up: async d => {
      const f = $('#file').files[0]; if (!f) throw new Error('Choose an image');
      const r = await api('upload', { title: d.title, descr: d.descr, data: await shrink(f) });
      location.hash = '#/i/' + r.id;
    } });
}

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

async function modPanel(q = '') {
  if (me?.role !== 'mod') { location.hash = '#/'; return; }
  const [{ users }, { images }] = await Promise.all([api('users', null, '&q=' + encodeURIComponent(q)), api('feed')]);
  page(`<h2>Moderator panel</h2><form id="us" class="row"><input name="q" value="${esc(q)}" placeholder="Search usernames"><button>Search</button></form>
    <div class="scroll"><table><tr><th>User</th><th>Status</th><th>Tag</th><th>Ban</th></tr>${users.map(u => {
      const b = u.ban_until && new Date(u.ban_until) > new Date();
      return `<tr><td>${who(u)}<br><small>${u.role}</small></td>
      <td>${b ? `Banned until ${date(u.ban_until)}<br>${esc(u.ban_reason)}<br><button onclick="mod('unban',{id:'${u.id}'})">Unban</button>` : 'Active'}</td>
      <td><input id="t-${u.id}" value="${esc(u.tag || '')}" maxlength="12" size="8"> <button onclick="mod('settag',{id:'${u.id}',tag:$('#t-${u.id}').value})">Save tag</button></td>
      <td>${u.role === 'mod' ? 'Moderator' : `<select id="d-${u.id}"><option value="1">1 hour</option><option value="24">1 day</option><option value="168">7 days</option><option value="720">30 days</option><option value="876000">Permanent</option></select>
      <input id="r-${u.id}" placeholder="Reason (required)" maxlength="200"> <button class="danger" onclick="mod('ban',{id:'${u.id}',hours:$('#d-${u.id}').value,reason:$('#r-${u.id}').value})">Ban</button>`}</td></tr>`;
    }).join('')}</table></div>
    <h3>Recent images</h3><div class="grid">${images.map(i => `<div class="card"><a href="#/i/${i.id}"><img src="${esc(i.url)}" alt=""></a><h3>${esc(i.title)}</h3><p>${who(i.user)}</p><button class="danger" onclick="mod('delimage',{id:'${i.id}'})">Delete image</button></div>`).join('')}</div>`,
    { us: d => modPanel(d.q) });
}
const mod = (a, b) => (a !== 'delimage' || confirm('Delete this image?')) && act(async () => { await api(a, b); modPanel(); });

// ---------- router ----------
const routes = { '': feed, i: view, up: upload, login: auth, set: settings, mod: () => modPanel() };
async function route() {
  const [, p = '', id] = location.hash.slice(1).split('/');
  try { await (Object.hasOwn(routes, p) ? routes[p] : feed)(id); }
  catch (e) { app.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}
addEventListener('hashchange', route);
$('#q').onchange = () => location.hash.length > 2 ? (location.hash = '#/') : route();
boot().then(route);
