require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { verifyMessage } = require('ethers');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const users = new Map();
const metadata = new Map();
const verifications = new Map();
let nextVerificationId = 1;
let databaseMode = 'memory';
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
  address: { type: String, unique: true, required: true, lowercase: true },
  nonce: String,
  displayName: String,
  email: String,
  organization: String,
  accountType: { type: String, enum: ['individual', 'company', 'university', 'research_lab'] },
  country: String,
  bio: String,
  role: { type: String, enum: ['buyer', 'reseller', 'inventor', 'admin'], default: 'buyer' },
  inventorStatus: { type: String, enum: ['none', 'pending', 'verified', 'rejected'], default: 'none' },
  primaryRole: { type: String, enum: ['inventor', 'buyer', 'reseller'] },
  onboardingComplete: { type: Boolean, default: false },
  lastLoginAt: Date
}, { timestamps: true }));
const PatentMeta = mongoose.models.PatentMeta || mongoose.model('PatentMeta', new mongoose.Schema({
  patentId: { type: String, unique: true, required: true },
  cid: { type: String, required: true },
  title: String,
  abstract: String,
  category: String,
  keywords: [String],
  inventorAddress: String,
  verification: { type: String, default: 'pending' },
  adminNote: String
}, { timestamps: true }));
const InventorVerification = mongoose.models.InventorVerification || mongoose.model('InventorVerification', new mongoose.Schema({
  address: { type: String, required: true, lowercase: true },
  fullName: String,
  organization: String,
  idType: String,
  idLast4: { type: String, maxlength: 4 },
  filingNumber: String,
  statement: String,
  message: String,
  signature: String,
  supportingDocCid: String,
  status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  adminNote: String,
  reviewedBy: String,
  txHash: String
}, { timestamps: true }));
const uploadDir = path.join(__dirname, 'uploads');
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const jwtSecret = process.env.JWT_SECRET || 'local-academic-demo-secret';
const adminAddress = (process.env.ADMIN_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266').toLowerCase();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: clientUrl }));
app.use(express.json());
app.use(morgan('dev'));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 }));

function normalizeAddress(address) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address || '')) throw new Error('Invalid wallet address');
  return address.toLowerCase();
}
function tokenFor(address, role, inventorStatus) { return jwt.sign({ address, role, inventorStatus }, jwtSecret, { expiresIn: '8h' }); }
async function getUser(address) { return databaseMode === 'mongodb' ? User.findOne({ address }).lean() : users.get(address); }
async function saveUser(user) {
  if (databaseMode === 'mongodb') return User.findOneAndUpdate({ address: user.address }, user, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  users.set(user.address, user);
  return user;
}
async function getMetadata(patentId) { return databaseMode === 'mongodb' ? PatentMeta.findOne({ patentId }).lean() : metadata.get(patentId); }
async function saveMetadata(record) {
  if (databaseMode === 'mongodb') return PatentMeta.findOneAndUpdate({ patentId: record.patentId }, record, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  metadata.set(record.patentId, record);
  return record;
}
function auth(req, res, next) {
  try {
    const value = req.headers.authorization || '';
    if (!value.startsWith('Bearer ')) return res.status(401).json({ error: 'Wallet sign-in required' });
    const payload = jwt.verify(value.slice(7), jwtSecret);
    req.address = normalizeAddress(payload.address);
    req.role = payload.role || 'buyer';
    req.inventorStatus = payload.inventorStatus || 'none';
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired session' }); }
}
function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.role) ? next() : res.status(403).json({ error: `Role required: ${roles.join(' or ')}` });
}
function admin(req, res, next) {
  if (req.address !== adminAddress || req.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'patent-chain-api', database: databaseMode }));
app.get('/api/auth/nonce/:address', async (req, res) => {
  try {
    const address = normalizeAddress(req.params.address);
    const nonce = crypto.randomBytes(16).toString('hex');
    await saveUser({ ...((await getUser(address)) || {}), address, nonce });
    res.json({ address, message: `Sign in to PatentChain. Nonce: ${nonce}` });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/auth/verify', async (req, res) => {
  try {
    const address = normalizeAddress(req.body.address);
    const requestedRole = ['buyer', 'reseller', 'inventor', 'admin'].includes(req.body.requestedRole) ? req.body.requestedRole : 'buyer';
    const user = await getUser(address);
    if (!user || !user.nonce) return res.status(400).json({ error: 'Request a nonce first' });
    const message = `Sign in to PatentChain. Nonce: ${user.nonce}`;
    if (normalizeAddress(verifyMessage(message, req.body.signature)) !== address) return res.status(401).json({ error: 'Signature does not match wallet' });
    const isAdmin = address === adminAddress;
    if (requestedRole === 'admin' && !isAdmin) return res.status(403).json({ error: 'This wallet is not the platform admin' });
    const inventorStatus = user.inventorStatus || 'none';
    if (requestedRole === 'inventor' && inventorStatus !== 'verified') return res.status(403).json({ error: `Inventor verification is ${inventorStatus}`, inventorStatus });
    const role = isAdmin && requestedRole === 'admin' ? 'admin' : requestedRole;
    const updated = await saveUser({ ...user, role, inventorStatus, nonce: null, lastLoginAt: new Date() });
    res.json({ token: tokenFor(address, role, inventorStatus), address, role, inventorStatus, isAdmin: role === 'admin' });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/users/me', auth, async (req, res) => res.json((await getUser(req.address)) || { address: req.address }));
app.put('/api/users/me', auth, async (req, res) => {
  const current = (await getUser(req.address)) || { address: req.address };
  const allowed = ['displayName', 'email', 'organization', 'accountType', 'country', 'bio', 'primaryRole', 'onboardingComplete'];
  const updated = { ...current };
  allowed.forEach((key) => { if (req.body[key] !== undefined) updated[key] = req.body[key]; });
  res.json(await saveUser(updated));
});
app.get('/api/users/lookup', async (req, res) => {
  const addresses = String(req.query.addresses || '').split(',').filter(Boolean).map((address) => address.toLowerCase());
  const result = await Promise.all(addresses.map(async (address) => { const user = await getUser(address); return { address, displayName: user?.displayName || null, organization: user?.organization || null }; }));
  res.json(result);
});
app.post('/api/verification', auth, async (req, res) => {
  const required = ['fullName', 'idType', 'idLast4', 'filingNumber', 'statement', 'message', 'signature'];
  if (required.some((field) => !req.body[field])) return res.status(400).json({ error: 'All inventor verification fields are required' });
  if (!/^[A-Za-z0-9]{4}$/.test(req.body.idLast4)) return res.status(400).json({ error: 'Only the last four ID characters are allowed' });
  const record = { ...req.body, address: req.address, status: 'pending', createdAt: new Date() };
  if (databaseMode === 'mongodb') {
    const saved = await InventorVerification.create(record);
    await saveUser({ ...((await getUser(req.address)) || { address: req.address }), inventorStatus: 'pending' });
    return res.status(201).json(saved);
  }
  const saved = { ...record, _id: String(nextVerificationId++) };
  verifications.set(saved._id, saved);
  await saveUser({ ...((await getUser(req.address)) || { address: req.address }), inventorStatus: 'pending' });
  res.status(201).json(saved);
});
app.get('/api/verification/me', auth, async (req, res) => {
  if (databaseMode === 'mongodb') return res.json(await InventorVerification.find({ address: req.address }).sort({ createdAt: -1 }).lean());
  res.json([...verifications.values()].filter((item) => item.address === req.address));
});
app.get('/api/admin/verifications', auth, admin, async (req, res) => {
  const status = req.query.status;
  if (databaseMode === 'mongodb') return res.json(await InventorVerification.find(status ? { status } : {}).sort({ createdAt: -1 }).lean());
  res.json([...verifications.values()].filter((item) => !status || item.status === status));
});
app.put('/api/admin/verifications/:id', auth, admin, async (req, res) => {
  const { decision, note, txHash } = req.body;
  if (!['verified', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Decision must be verified or rejected' });
  if (decision === 'verified' && !txHash) return res.status(400).json({ error: 'Approval requires the on-chain verification transaction hash' });
  const existing = databaseMode === 'mongodb' ? await InventorVerification.findById(req.params.id) : verifications.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Verification request not found' });
  const updated = { ...existing.toObject?.() || existing, status: decision, adminNote: note || '', reviewedBy: req.address, txHash: txHash || '' };
  if (databaseMode === 'mongodb') await InventorVerification.findByIdAndUpdate(req.params.id, updated);
  else verifications.set(req.params.id, updated);
  if (decision === 'verified') await saveUser({ ...((await getUser(existing.address)) || { address: existing.address }), inventorStatus: 'verified' });
  else await saveUser({ ...((await getUser(existing.address)) || { address: existing.address }), inventorStatus: 'rejected' });
  res.json(updated);
});
app.post('/api/ipfs/upload', auth, requireRole('inventor', 'admin'), upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No PDF uploaded' });
    if (file.mimetype !== 'application/pdf' || file.buffer.subarray(0, 4).toString() !== '%PDF') return res.status(400).json({ error: 'Only valid PDF files are allowed' });
    if ((process.env.MOCK_IPFS || 'true') === 'true' || !process.env.PINATA_JWT) {
      const cid = `Qm${crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 44)}`;
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, `${cid}.pdf`), file.buffer);
      return res.json({ cid, url: `${process.env.API_URL || 'http://localhost:4000'}/files/${cid}`, mock: true });
    }
    const form = new FormData();
    form.append('file', new Blob([file.buffer], { type: 'application/pdf' }), file.originalname);
    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: form });
    const result = await response.json();
    if (!response.ok) return res.status(502).json({ error: 'Pinata upload failed', detail: result });
    res.json({ cid: result.IpfsHash, url: `${process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs/'}${result.IpfsHash}`, mock: false });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/files/:cid', (req, res) => {
  if (!/^[A-Za-z0-9]+$/.test(req.params.cid)) return res.status(400).end();
  const file = path.join(uploadDir, `${req.params.cid}.pdf`);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.type('application/pdf').sendFile(file);
});
app.post('/api/patents/meta', auth, requireRole('inventor', 'admin'), async (req, res) => {
  const patentId = String(req.body.patentId || '');
  if (!patentId || !req.body.cid) return res.status(400).json({ error: 'patentId and cid are required' });
  const record = { ...req.body, patentId, inventorAddress: req.address };
  res.status(201).json(await saveMetadata(record));
});
app.get('/api/patents/meta', async (_req, res) => res.json(databaseMode === 'mongodb' ? await PatentMeta.find().lean() : [...metadata.values()]));
app.get('/api/patents/meta/:patentId', async (req, res) => {
  const record = await getMetadata(req.params.patentId);
  if (!record) return res.status(404).json({ error: 'Metadata not found' });
  res.json(record);
});
app.get('/api/admin/users', auth, admin, async (_req, res) => res.json(databaseMode === 'mongodb' ? await User.find().select('-nonce').lean() : [...users.values()].map(({ nonce, ...user }) => user)));
app.put('/api/admin/patents/:patentId/verification', auth, admin, async (req, res) => {
  const record = (await getMetadata(req.params.patentId)) || { patentId: req.params.patentId };
  const updated = { ...record, verification: req.body.verification || 'pending', adminNote: req.body.adminNote || '' };
  res.json(await saveMetadata(updated));
});

const port = process.env.PORT || 4000;
async function start() {
  if (process.env.MONGO_URI) {
    try { await mongoose.connect(process.env.MONGO_URI); databaseMode = 'mongodb'; }
    catch (error) { console.warn(`MongoDB unavailable, using memory storage: ${error.message}`); }
  }
  app.listen(port, () => console.log(`PatentChain API listening on http://localhost:${port} (${databaseMode})`));
}
start();
