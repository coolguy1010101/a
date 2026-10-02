const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = 'images', JWT = process.env.JWT_SECRET;
const fail = (m, c = 400) => { throw Object.assign(new Error(m), { c }); };
const txt = (s, n) => String(s ?? '').trim().slice(0, n);
const pub = u => ({ id: u.id, username: u.username, tag: u.tag, role: u.role });
const url = p => db.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
const sign = u => jwt.sign({ id: u.id, tv: u.tv }, JWT, { expiresIn: '7d' });
const banned = u => u.ban_until && new Date(u.ban_until) > new Date();
const okEmail = e => /^\S+@\S+\.\S+$/.test(e);

async function getUser(req, optional) {
  try {
    const p = jwt.verify((req.headers.authorization || '').slice(7), JWT);
    const { data: u } = await db.from('users').select('*').eq('id', p.id).maybeSingle();
    if (u && u.tv === p.tv) return u;
  } catch {}
  if (!optional) fail('Please log in', 401);
  return null;
}
async function authed(req, mod) {
  const u = await getUser(req);
  if (banned(u)) fail(`You are banned until ${new Date(u.ban_until).toUTCString()}. Reason: ${u.ban_reason}`, 403);
  if (mod && u.role !== 'mod') fail('Moderators only', 403);
  return u;
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
    if (error) fail(error.code === '23505' ? 'Username or email already taken' : 'DEBUG: ' + error.message, 409);
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
    return { user: { ...pub(u), email: u.email }, ban: banned(u) ? { until: u.ban_until, reason: u.ban_reason } : null };
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
    const { data } = await db.from('images').select('path').eq('user_id', u.id);
    if (data?.length) await db.storage.from(BUCKET).remove(data.map(r => r.path));
    await db.from('users').delete().eq('id', u.id); // cascades to images, likes, comments
    return {};
  },

  // ---------- images ----------
  async feed(req) {
    const q = txt(req.query.q, 50).replace(/[%_,()]/g, '');
    let s = db.from('images').select('id,title,path,users(username,tag,role),likes(count),comments(count)').order('created_at', { ascending: false }).limit(60);
    if (q) s = s.ilike('title', `%${q}%`);
    const { data } = await s;
    return { images: (data || []).map(i => ({ id: i.id, title: i.title, url: url(i.path), user: i.users, likes: i.likes[0].count, comments: i.comments[0].count })) };
  },
  async image(req) {
    const me = await getUser(req, true), id = req.query.id;
    const { data: i } = await db.from('images').select('*,users(username,tag,role),likes(count)').eq('id', id).maybeSingle();
    if (!i) fail('Image not found', 404);
    const { data: c } = await db.from('comments').select('id,body,created_at,user_id,users(username,tag,role)').eq('image_id', id).order('created_at');
    const { data: l } = me ? await db.from('likes').select('user_id').eq('image_id', id).eq('user_id', me.id) : { data: [] };
    return { image: { id: i.id, title: i.title, descr: i.descr, url: url(i.path), created_at: i.created_at, owner: i.user_id, user: i.users, likes: i.likes[0].count, liked: !!l.length }, comments: c || [] };
  },
  async upload(req, b) {
    const u = await authed(req), title = txt(b.title, 100);
    const m = /^data:image\/(png|jpeg|webp|gif);base64,([\w+/=]+)$/.exec(b.data || '');
    if (!title) fail('Add a title');
    if (!m) fail('Unsupported image');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 4e6) fail('Image is too large (4 MB max)');
    const path = `${u.id}/${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: `image/${m[1]}` });
    if (error) fail('Upload failed', 500);
    const { data } = await db.from('images').insert({ user_id: u.id, title, descr: txt(b.descr, 1000), path }).select('id').single();
    return { id: data.id };
  },
  async delimage(req, b) {
    const u = await authed(req);
    const { data: i } = await db.from('images').select('user_id,path').eq('id', b.id).maybeSingle();
    if (!i || (i.user_id !== u.id && u.role !== 'mod')) fail('Not allowed', 403);
    await db.storage.from(BUCKET).remove([i.path]);
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
    if (!c || (c.user_id !== u.id && u.role !== 'mod')) fail('Not allowed', 403);
    await db.from('comments').delete().eq('id', b.id);
    return {};
  },

  // ---------- moderation ----------
  async users(req) {
    await authed(req, true);
    const q = txt(req.query.q, 20).replace(/[%_,()]/g, '');
    const { data } = await db.from('users').select('id,username,role,tag,ban_until,ban_reason').ilike('username', `%${q}%`).order('created_at', { ascending: false }).limit(30);
    return { users: data || [] };
  },
  async ban(req, b) {
    await authed(req, true);
    const reason = txt(b.reason, 200), hours = Math.min(+b.hours || 0, 876000);
    if (reason.length < 3) fail('A ban reason is required');
    if (hours <= 0) fail('Choose a duration');
    const { data: t } = await db.from('users').select('role').eq('id', b.id).maybeSingle();
    if (!t || t.role === 'mod') fail('You cannot ban this user', 403);
    await db.from('users').update({ ban_until: new Date(Date.now() + hours * 36e5).toISOString(), ban_reason: reason }).eq('id', b.id);
    return {};
  },
  async unban(req, b) {
    await authed(req, true);
    await db.from('users').update({ ban_until: null, ban_reason: null }).eq('id', b.id);
    return {};
  },
  async settag(req, b) {
    await authed(req, true);
    const tag = txt(b.tag, 12);
    if (!/^[\w ]*$/.test(tag)) fail('Tags may only use letters, numbers and spaces');
    await db.from('users').update({ tag: tag || null }).eq('id', b.id);
    return {};
  },
};

const GET = new Set(['feed', 'image', 'me', 'users']);
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
