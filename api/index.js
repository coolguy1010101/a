const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = 'images', VIDEOS = 'videos', JWT = process.env.JWT_SECRET;
const fail = (m, c = 400) => { throw Object.assign(new Error(m), { c }); };
const txt = (s, n) => String(s ?? '').trim().slice(0, n);
const pub = u => ({ id: u.id, username: u.username, tag: u.tag, role: u.role });
const url = p => db.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
const vurl = p => db.storage.from(VIDEOS).getPublicUrl(p).data.publicUrl;
const sign = u => jwt.sign({ id: u.id, tv: u.tv }, JWT, { expiresIn: '7d' });
const banned = u => u.ban_until && new Date(u.ban_until) > new Date();
const okEmail = e => /^\S+@\S+\.\S+$/.test(e);
const RANK = { user: 0, staff: 1, senior: 2, owner: 3 };
const LABEL = { user: null, staff: 'STAFF', senior: 'SENIOR STAFF', owner: 'OWNER' };
const VEXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const rk = u => RANK[u.role] ?? 0;
const can = (u, p) => rk(u) >= 2 || (rk(u) === 1 && (u.perms || []).includes(p));

function readImage(s, max) {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,([\w+/=]+)$/.exec(s || '');
  if (!m) fail('Unsupported image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > max) fail('Image is too large');
  return { buf, type: `image/${m[1]}`, ext: m[1] === 'jpeg' ? 'jpg' : m[1] };
}
async function getUser(req, optional) {
  try {
    const p = jwt.verify((req.headers.authorization || '').slice(7), JWT);
    const { data: u } = await db.from('users').select('*').eq('id', p.id).maybeSingle();
    if (u && u.tv === p.tv) return u;
  } catch {}
  if (!optional) fail('Please log in', 401);
  return null;
}
// need = a role name ('staff', 'senior', 'owner') or a permission ('img', 'cmt', 'ban', 'news')
async function authed(req, need) {
  const u = await getUser(req);
  if (banned(u)) fail(`You are banned until ${new Date(u.ban_until).toUTCString()}. Reason: ${u.ban_reason}`, 403);
  if (need && !(RANK[need] !== undefined ? rk(u) >= RANK[need] : can(u, need))) fail('You do not have permission to do that', 403);
  return u;
}
async function lower(u, id) { // the target must rank below you
  const { data: t } = await db.from('users').select('id,role').eq('id', id).maybeSingle();
  if (!t || rk(t) >= rk(u)) fail('You cannot do that to this user', 403);
  return t;
}
async function sure(u, pw) {
  if (!(await bcrypt.compare(String(pw || ''), u.pass))) fail('Wrong password', 403);
}

const R = {
  // ---------- accounts ----------
  async register(req, b) {
    const username = txt(b.username, 20), email = txt(b.email, 100).toLowerCase(), pw = String(b.password || '');
    if (!/^\w{3,20}$/.test(username)) fail('Username: 3-20 letters, numbers or underscores');
    if (!okEmail(email)) fail('Enter a valid email');
    if (pw.length < 8) fail('Password must be at least 8 characters');
    const { data: u, error } = await db.from('users').insert({ username, email, pass: await bcrypt.hash(pw, 10) }).select().single();
    if (error) fail(error.code === '23505' ? 'Username or email already taken' : 'Could not create account', 409);
    return { token: sign(u) };
  },
  async login(req, b) {
    const l = txt(b.login, 100), mail = l.includes('@');
    const { data: u } = await db.from('users').select('*').eq(mail ? 'email' : 'username', mail ? l.toLowerCase() : l).maybeSingle();
    if (!u || !(await bcrypt.compare(String(b.password || ''), u.pass))) fail('Wrong username/email or password', 401);
    return { token: sign(u) };
  },
  async me(req) {
    const u = await getUser(req);
    return { user: { ...pub(u), email: u.email, perms: u.perms || [], bio: u.bio }, ban: banned(u) ? { until: u.ban_until, reason: u.ban_reason } : null };
  },
  async changepw(req, b) {
    const u = await authed(req); await sure(u, b.old);
    if (String(b.new || '').length < 8) fail('New password must be at least 8 characters');
    const { data } = await db.from('users').update({ pass: await bcrypt.hash(String(b.new), 10), tv: u.tv + 1 }).eq('id', u.id).select().single();
    return { token: sign(data) };
  },
  async changeemail(req, b) {
    const u = await authed(req); await sure(u, b.password);
    const email = txt(b.email, 100).toLowerCase();
    if (!okEmail(email)) fail('Enter a valid email');
    const { error } = await db.from('users').update({ email }).eq('id', u.id);
    if (error) fail('That email is already in use', 409);
    return {};
  },
  async logoutall(req) {
    const u = await getUser(req);
    await db.from('users').update({ tv: u.tv + 1 }).eq('id', u.id);
    return {};
  },
  async deleteacct(req, b) {
    const u = await getUser(req); await sure(u, b.password);
    const { data } = await db.from('images').select('path,video').eq('user_id', u.id);
    const files = (data || []).map(r => r.path), vids = (data || []).map(r => r.video).filter(Boolean);
    if (u.avatar) files.push(u.avatar);
    if (files.length) await db.storage.from(BUCKET).remove(files);
    if (vids.length) await db.storage.from(VIDEOS).remove(vids);
    await db.from('users').delete().eq('id', u.id);
    return {};
  },

  // ---------- profiles ----------
  async profile(req) {
    const { data: u } = await db.from('users').select('id,username,tag,role,bio,avatar,created_at').eq('username', txt(req.query.name, 20)).maybeSingle();
    if (!u) fail('User not found', 404);
    return { user: { ...pub(u), bio: u.bio, created_at: u.created_at, avatarUrl: u.avatar ? url(u.avatar) : null } };
  },
  async saveprofile(req, b) {
    const u = await authed(req), upd = { bio: txt(b.bio, 300) || null };
    if (b.avatar) {
      const img = readImage(b.avatar, 3e5);
      const path = `avatars/${u.id}-${Date.now()}.${img.ext}`;
      const { error } = await db.storage.from(BUCKET).upload(path, img.buf, { contentType: img.type });
      if (error) fail('Could not save the picture', 500);
      if (u.avatar) await db.storage.from(BUCKET).remove([u.avatar]);
      upd.avatar = path;
    }
    await db.from('users').update(upd).eq('id', u.id);
    return {};
  },
  async clearprofile(req, b) {
    const u = await authed(req, 'img'); await lower(u, b.id);
    const { data } = await db.from('users').select('avatar').eq('id', b.id).maybeSingle();
    if (data?.avatar) await db.storage.from(BUCKET).remove([data.avatar]);
    await db.from('users').update({ bio: null, avatar: null }).eq('id', b.id);
    return {};
  },

  // ---------- posts (images and videos) ----------
  async feed(req) {
    const q = txt(req.query.q, 50).replace(/[%_,()]/g, ''), tag = txt(req.query.tag, 30), uid = txt(req.query.uid, 40);
    const page = Math.max(1, +req.query.page || 1), N = 24;
    let s = db.from('images').select('id,title,path,kind,tags,users!user_id(username,tag,role),likes(count),comments(count)', { count: 'exact' }).order('created_at', { ascending: false }).range((page - 1) * N, page * N - 1);
    if (q) s = s.ilike('title', `%${q}%`);
    if (tag) s = s.contains('tags', [tag]);
    if (uid) s = s.eq('user_id', uid);
    const { data, count } = await s;
    return { total: count || 0, pages: Math.max(1, Math.ceil((count || 0) / N)), images: (data || []).map(i => ({ id: i.id, title: i.title, kind: i.kind, tags: i.tags, url: url(i.path), user: i.users, likes: i.likes[0].count, comments: i.comments[0].count })) };
  },
  async image(req) {
    const me = await getUser(req, true), id = req.query.id;
    const { data: i } = await db.from('images').select('*,users!user_id(username,tag,role),likes(count)').eq('id', id).maybeSingle();
    if (!i) fail('Image not found', 404);
    const { data: c } = await db.from('comments').select('id,body,created_at,user_id,users!user_id(username,tag,role)').eq('image_id', id).order('created_at');
    const { data: l } = me ? await db.from('likes').select('user_id').eq('image_id', id).eq('user_id', me.id) : { data: [] };
    return { image: { id: i.id, title: i.title, descr: i.descr, tags: i.tags, kind: i.kind, video: i.video ? vurl(i.video) : null, url: url(i.path), created_at: i.created_at, owner: i.user_id, user: i.users, likes: i.likes[0].count, liked: !!l.length }, comments: c || [] };
  },
  // Step 1 of a video upload: hand the browser a one-time URL to upload straight to Supabase
  async signvideo(req, b) {
    const u = await authed(req);
    if (!Object.hasOwn(VEXT, b.type)) fail('Use an MP4, WebM or MOV video');
    const path = `${u.id}/${Date.now()}.${VEXT[b.type]}`;
    const { data, error } = await db.storage.from(VIDEOS).createSignedUploadUrl(path);
    if (error) fail('Could not start the upload', 500);
    return { path, signedUrl: data.signedUrl };
  },
  // For videos, b.data is the thumbnail and b.video is the path from signvideo
  async upload(req, b) {
    const u = await authed(req), title = txt(b.title, 100);
    if (!title) fail('Add a title');
    const img = readImage(b.data, 4e6);
    let video = null;
    if (b.video) {
      video = String(b.video);
      if (!new RegExp(`^${u.id}/\\d+\\.(mp4|webm|mov)$`).test(video)) fail('Invalid video');
      const { data } = await db.storage.from(VIDEOS).list(u.id, { search: video.split('/')[1] });
      if (!(data || []).some(f => f.name === video.split('/')[1])) fail('The video upload was not found. Please try again.');
    }
    const { data: known } = await db.from('tags').select('name');
    const tags = [...new Set([].concat(b.tags || []))].filter(t => (known || []).some(k => k.name === t)).slice(0, 5);
    const path = `${u.id}/${Date.now()}.${img.ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, img.buf, { contentType: img.type });
    if (error) fail('Upload failed', 500);
    const { data } = await db.from('images').insert({ user_id: u.id, title, descr: txt(b.descr, 1000), path, tags, kind: video ? 'video' : 'image', video }).select('id').single();
    return { id: data.id };
  },
  async delimage(req, b) {
    const u = await authed(req);
    const { data: i } = await db.from('images').select('user_id,path,video').eq('id', b.id).maybeSingle();
    if (!i || (i.user_id !== u.id && !can(u, 'img'))) fail('Not allowed', 403);
    await db.storage.from(BUCKET).remove([i.path]);
    if (i.video) await db.storage.from(VIDEOS).remove([i.video]);
    await db.from('images').delete().eq('id', b.id);
    return {};
  },
  async like(req, b) {
    const u = await authed(req), k = { image_id: b.id, user_id: u.id };
    const { data } = await db.from('likes').select('user_id').match(k).maybeSingle();
    await (data ? db.from('likes').delete().match(k) : db.from('likes').insert(k));
    return {};
  },
  async comment(req, b) {
    const u = await authed(req), body = txt(b.body, 500);
    if (!body) fail('Write a comment first');
    const { error } = await db.from('comments').insert({ image_id: b.id, user_id: u.id, body });
    if (error) fail('Could not post comment');
    return {};
  },
  async delcomment(req, b) {
    const u = await authed(req);
    const { data: c } = await db.from('comments').select('user_id').eq('id', b.id).maybeSingle();
    if (!c || (c.user_id !== u.id && !can(u, 'cmt'))) fail('Not allowed', 403);
    await db.from('comments').delete().eq('id', b.id);
    return {};
  },

  // ---------- staff ----------
  async users(req) {
    await authed(req, 'staff');
    const q = txt(req.query.q, 20).replace(/[%_,()]/g, '');
    const { data } = await db.from('users').select('id,username,role,tag,perms,ban_until,ban_reason').ilike('username', `%${q}%`).order('created_at', { ascending: false }).limit(30);
    return { users: data || [] };
  },
  async ban(req, b) {
    const u = await authed(req, 'ban');
    const reason = txt(b.reason, 200), hours = Math.min(+b.hours || 0, 876000);
    if (reason.length < 3) fail('A ban reason is required');
    if (hours <= 0) fail('Choose a duration');
    await lower(u, b.id);
    await db.from('users').update({ ban_until: new Date(Date.now() + hours * 36e5).toISOString(), ban_reason: reason }).eq('id', b.id);
    return {};
  },
  async unban(req, b) {
    const u = await authed(req, 'ban'); await lower(u, b.id);
    await db.from('users').update({ ban_until: null, ban_reason: null }).eq('id', b.id);
    return {};
  },
  async settag(req, b) {
    const u = await authed(req, 'senior'); await lower(u, b.id);
    const tag = txt(b.tag, 12);
    if (!/^[\w ]*$/.test(tag)) fail('Tags may only use letters, numbers and spaces');
    await db.from('users').update({ tag: tag || null }).eq('id', b.id);
    return {};
  },
  async setperms(req, b) {
    const u = await authed(req, 'senior'), t = await lower(u, b.id);
    if (t.role !== 'staff') fail('Permissions only apply to staff');
    const perms = [].concat(b.perms || []).filter(p => ['img', 'cmt', 'ban', 'news'].includes(p));
    await db.from('users').update({ perms }).eq('id', b.id);
    return {};
  },
  async setrole(req, b) { // owner only: promote or demote
    const u = await authed(req, 'owner'); await lower(u, b.id);
    if (!['user', 'staff', 'senior'].includes(b.role)) fail('Invalid role');
    await db.from('users').update({ role: b.role, tag: LABEL[b.role], perms: b.role === 'staff' ? ['img', 'cmt', 'ban'] : [] }).eq('id', b.id);
    return {};
  },

  // ---------- post tags ----------
  async tags() {
    const { data } = await db.from('tags').select('name').order('name');
    return { tags: (data || []).map(t => t.name) };
  },
  async addtag(req, b) {
    await authed(req, 'senior');
    const n = txt(b.name, 20).toLowerCase();
    if (!/^[a-z0-9-]{2,20}$/.test(n)) fail('Tag names: 2-20 letters, numbers or dashes');
    const { error } = await db.from('tags').insert({ name: n });
    if (error) fail('That tag already exists', 409);
    return {};
  },
  async deltag(req, b) {
    await authed(req, 'senior');
    const n = txt(b.name, 20);
    await db.from('tags').delete().eq('name', n);
    const { data } = await db.from('images').select('id,tags').contains('tags', [n]);
    for (const r of data || []) await db.from('images').update({ tags: r.tags.filter(t => t !== n) }).eq('id', r.id);
    return {};
  },

  // ---------- news ----------
  async news() {
    const { data } = await db.from('news').select('id,body,created_at,user_id,users!user_id(username,tag,role)').order('created_at', { ascending: false }).limit(50);
    return { news: data || [] };
  },
  async addnews(req, b) {
    const u = await authed(req, 'news'), body = txt(b.body, 2000);
    if (!body) fail('Write an announcement first');
    await db.from('news').insert({ user_id: u.id, body });
    return {};
  },
  async delnews(req, b) {
    const u = await authed(req, 'news');
    const { data: n } = await db.from('news').select('user_id').eq('id', b.id).maybeSingle();
    if (!n || (n.user_id !== u.id && rk(u) < 2)) fail('Not allowed', 403);
    await db.from('news').delete().eq('id', b.id);
    return {};
  },
};

const GET = new Set(['feed', 'image', 'me', 'users', 'tags', 'news', 'profile']);
module.exports = async (req, res) => {
  try {
    const a = req.query.a;
    if (!Object.hasOwn(R, a) || GET.has(a) !== (req.method === 'GET')) fail('Not found', 404);
    res.status(200).json(await R[a](req, req.body || {}));
  } catch (e) {
    if (!e.c) console.error(e);
    res.status(e.c || 500).json({ error: e.c ? e.message : 'Server error' });
  }
};
