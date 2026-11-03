import React, { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { BrowserProvider, parseEther } from 'ethers';
import { contractAddress, normalizePatent, readContract, signerContract } from './lib/market';
import RegisterPage from './RegisterPage';

const demoAddress = '0x742d...35Ac';
const demoPatents = [
  { id: 1, name: 'AI Crop Disease Detection', category: 'Agritech', inventor: 'Abhijit Sharma', inventorWallet: '0x742d...35Ac', owner: 'Greenfield Labs', ownerWallet: '0x91b2...e981', price: 2.4, originalPrice: 1.5, royalty: 8, cid: 'QmDemoPatentCrop', status: 'Listed', resales: 2, earned: 0.16, color: 'mint' },
  { id: 2, name: 'Low-Power Edge Vision Sensor', category: 'Hardware', inventor: 'Murtaza Najmi', inventorWallet: '0x119a...8C42', owner: 'Murtaza Najmi', ownerWallet: '0x119a...8C42', price: 4.8, originalPrice: 4.8, royalty: 5, cid: 'QmDemoPatentVision', status: 'First sale', resales: 0, earned: 0, color: 'peach' },
  { id: 3, name: 'Bio-based Packaging Film', category: 'Materials', inventor: 'Prarambh Mehta', inventorWallet: '0x8d12...A102', owner: 'Circular Works', ownerWallet: '0xAe33...1f09', price: 3.2, originalPrice: 2.2, royalty: 6, cid: 'QmDemoPatentFilm', status: 'Listed', resales: 1, earned: 0.06, color: 'violet' }
];

function short(value) { return value?.length > 16 ? `${value.slice(0, 8)}...${value.slice(-5)}` : value; }
function money(value) { return `${Number(value).toFixed(2)} ETH`; }

export default function App() {
  const [wallet, setWallet] = useState('');
  const [role, setRole] = useState(sessionStorage.getItem('patentchain_role') || '');
  const [requestedRole, setRequestedRole] = useState('buyer');
  const [inventorStatus, setInventorStatus] = useState(sessionStorage.getItem('patentchain_inventor_status') || 'none');
  const [patents, setPatents] = useState(demoPatents);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    async function loadOnChainPatents() {
      if (!contractAddress) return;
      try {
        const contract = readContract();
        const result = await contract.getPatents(0, 50);
        setPatents(result.map(normalizePatent));
      } catch { setNotice('Contract not found. Demo data remains available.'); }
    }
    loadOnChainPatents();
  }, []);

  async function connectWallet() {
    if (!window.ethereum) { setNotice('MetaMask is not installed. Install it to sign in.'); return; }
    try {
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const address = accounts[0];
      const signer = await provider.getSigner();
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
      const nonceResponse = await fetch(`${apiUrl}/auth/nonce/${address}`);
      const nonce = await nonceResponse.json();
      if (!nonceResponse.ok) throw new Error(nonce.error || 'Could not request sign-in nonce');
      setNotice('Approve the sign-in message in MetaMask. No gas is charged.');
      const signature = await signer.signMessage(nonce.message);
      const loginResponse = await fetch(`${apiUrl}/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, signature, requestedRole }) });
      const login = await loginResponse.json();
      if (!loginResponse.ok) throw new Error(login.error || 'Wallet sign-in failed');
      sessionStorage.setItem('patentchain_token', login.token);
      sessionStorage.setItem('patentchain_role', login.role);
      sessionStorage.setItem('patentchain_inventor_status', login.inventorStatus || 'none');
      setWallet(address);
      setRole(login.role);
      setInventorStatus(login.inventorStatus || 'none');
      setNotice('Wallet connected and signed in.');
    } catch (error) { setNotice(error.code === 4001 ? 'You rejected the MetaMask request.' : error.message || 'Wallet sign-in failed.'); }
  }
  function addPatent(patent) { setPatents((items) => [patent, ...items]); setNotice('Patent registered in the demo marketplace.'); }
  async function buyPatent(id) {
    try {
      if (contractAddress && wallet) {
        const contract = await signerContract();
        const count = Number(await contract.patentCount());
        if (!Number.isInteger(Number(id)) || Number(id) < 1 || Number(id) > count) throw new Error('This patent is not registered on the current blockchain. Return to the marketplace and choose a seeded patent.');
        const patent = await contract.getPatentDetails(id);
        const method = Number(patent.saleCount) === 0 ? 'buyPatent' : 'resellPatent';
        const tx = await contract[method](id, { value: patent.salePrice });
        setNotice(`Transaction pending: ${tx.hash.slice(0, 12)}...`);
        await tx.wait();
        setNotice('Purchase confirmed on-chain.');
        const refreshed = await readContract().getPatents(0, 50);
        setPatents(refreshed.map(normalizePatent));
        return;
      }
      setPatents((items) => items.map((item) => item.id === id ? { ...item, owner: 'Connected wallet', ownerWallet: wallet || demoAddress, status: 'Owned', price: 0 } : item));
      setNotice('Demo purchase complete. Configure a contract address for a real transaction.');
    } catch (error) { setNotice(error.shortMessage || error.message || 'Transaction failed.'); }
  }
  async function listPatent(id, price) {
    try {
      if (contractAddress && wallet) {
        const contract = await signerContract();
        const tx = await contract.listForSale(id, parseEther(String(price)));
        setNotice(`Listing transaction pending: ${tx.hash.slice(0, 12)}...`);
        await tx.wait();
        setNotice('Patent listed on-chain.');
        const refreshed = await readContract().getPatents(0, 50);
        setPatents(refreshed.map(normalizePatent));
        return;
      }
      setPatents((items) => items.map((item) => item.id === id ? { ...item, price, status: 'Listed' } : item));
      setNotice('Patent listed in demo mode.');
    } catch (error) { setNotice(error.shortMessage || error.message || 'Listing failed.'); }
  }

  return <div className="app-shell">
    <header className="topbar"><Link to="/" className="brand"><span className="brand-mark">P</span><span>Patent<span className="brand-accent">Chain</span></span></Link><nav><NavLink to="/marketplace">Marketplace</NavLink><NavLink to="/dashboard">Dashboard</NavLink><NavLink to="/history">History</NavLink></nav><div className="wallet-tools">{!wallet && <select className="role-select" value={requestedRole} onChange={(event) => setRequestedRole(event.target.value)}><option value="buyer">Buyer / Company</option><option value="reseller">Reseller / Owner</option><option value="inventor">Inventor</option><option value="admin">Admin</option></select>} {role && <span className="role-badge">{role}{role === 'inventor' && inventorStatus !== 'verified' ? ` · ${inventorStatus}` : ''}</span>}<button className="wallet-button" onClick={connectWallet}>{wallet ? short(wallet) : 'Connect wallet'} <span>↗</span></button></div></header>
    {notice && <div className="notice" onClick={() => setNotice('')}>{notice}<span>×</span></div>}
    <Routes>
      <Route path="/" element={<Landing onConnect={connectWallet} />} />
      <Route path="/marketplace" element={<Marketplace patents={patents} />} />
      <Route path="/dashboard" element={<Dashboard patents={patents} wallet={wallet} />} />
      <Route path="/register" element={<RegisterPage wallet={wallet} />} />
      <Route path="/verification" element={<VerificationPage wallet={wallet} />} />
      <Route path="/admin" element={<AdminPage wallet={wallet} />} />
      <Route path="/patent/:id" element={<Details patents={patents} onBuy={buyPatent} onList={listPatent} />} />
      <Route path="/history" element={<History patents={patents} />} />
      <Route path="*" element={<Landing onConnect={connectWallet} />} />
    </Routes>
    <footer><span>PatentChain <b>Academic prototype</b></span><span>On-chain ownership records · Automated resale royalties</span></footer>
  </div>;
}

function Landing({ onConnect }) { return <main className="landing page-wrap"><section className="hero"><div className="eyebrow"><span className="live-dot" /> Polygon testnet ready</div><h1>Value should follow<br /><em>the invention.</em></h1><p>PatentChain turns patent resales into programmable agreements. Every transfer is visible. Every royalty is enforced by code.</p><div className="hero-actions"><Link className="button primary" to="/marketplace">Explore marketplace <span>→</span></Link><button className="button secondary" onClick={onConnect}>Connect wallet</button></div><div className="hero-foot"><span><strong>01</strong> Register once</span><span><strong>02</strong> Resell freely</span><span><strong>03</strong> Earn automatically</span></div></section><section className="signal-grid"><div className="signal-main"><span className="label">LIVE NETWORK</span><div className="signal-line"><strong>Royalty distribution</strong><span className="pill green">Automated</span></div><div className="split-visual"><div><strong>0.16 ETH</strong><small>Original inventor</small></div><div className="arrow">→</div><div><strong>1.84 ETH</strong><small>Current seller</small></div></div><div className="bar"><i /></div><small>8% of every resale is routed to the inventor wallet</small></div><div className="signal-side"><span className="label">CURRENTLY TRACKING</span><strong>3,842</strong><span>patent transfers</span><div className="mini-chart"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="signal-side coral"><span className="label">TOTAL ROYALTIES</span><strong>128.4 ETH</strong><span>returned to inventors</span><div className="trend">↗ 18.6% <small>this month</small></div></div></section><div className="disclaimer">PatentChain records digital transactions for demonstration purposes. Legal patent registration and ownership remain subject to the relevant patent authority.</div></main> }

function Marketplace({ patents }) { return <main className="page-wrap"><div className="page-heading"><div><span className="eyebrow">THE EXCHANGE</span><h2>Find the next<br /><em>breakthrough.</em></h2></div><Link className="button primary" to="/register">+ Register patent</Link></div><div className="toolbar"><span className="result-count">{patents.length} patents available</span><div className="filters"><button className="filter active">All sectors</button><button className="filter">Recently listed</button><button className="filter">Highest royalty</button></div></div><div className="patent-grid">{patents.map((patent) => <PatentCard key={patent.id} patent={patent} />)}</div></main> }

function PatentCard({ patent }) { return <Link to={`/patent/${patent.id}`} className="patent-card"><div className={`card-art ${patent.color}`}><span className="card-number">PAT-{String(patent.id).padStart(3, '0')}</span><span className="art-symbol">{patent.id === 1 ? '◌' : patent.id === 2 ? '▦' : '✳'}</span><span className="status">{patent.status}</span></div><div className="card-body"><div className="card-meta"><span>{patent.category}</span><span>{patent.royalty}% royalty</span></div><h3>{patent.name}</h3><div className="owner-row"><span className="avatar">{patent.inventor[0]}</span><span><small>Invented by</small><strong>{patent.inventor}</strong></span><span className="price"><small>Current price</small><strong>{money(patent.price)}</strong></span></div></div></Link> }

function Dashboard({ patents, wallet }) { const total = patents.reduce((sum, item) => sum + item.earned, 0); return <main className="page-wrap"><div className="page-heading compact"><div><span className="eyebrow">YOUR CONTROL ROOM</span><h2>Good morning, <em>inventor.</em></h2></div><span className="connected"><i /> {wallet ? short(wallet) : 'Demo workspace'}</span></div><div className="metric-grid"><Metric label="Total royalties" value={money(total)} detail="+18.6% this month" /><Metric label="Active patents" value="03" detail="2 currently listed" /><Metric label="Ownership transfers" value="08" detail="Across your portfolio" /><Metric label="Network" value="Polygon" detail="Amoy testnet" /></div><div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">PORTFOLIO</span><h3>Your patents</h3></div><Link to="/register">Register new ↗</Link></div>{patents.map((patent) => <Link className="portfolio-row" to={`/patent/${patent.id}`} key={patent.id}><span className={`tiny-art ${patent.color}`}>{patent.name[0]}</span><span className="portfolio-name"><strong>{patent.name}</strong><small>PAT-{String(patent.id).padStart(3, '0')} · {patent.owner}</small></span><span className="row-value"><small>Resale royalty</small><strong>{patent.royalty}%</strong></span><span className="row-status">{patent.status} <b>→</b></span></Link>)}</section><section className="panel royalty-panel"><div className="panel-heading"><div><span className="eyebrow">EARNINGS</span><h3>Royalty stream</h3></div><Link to="/history">View all ↗</Link></div><div className="earnings"><strong>{money(total)}</strong><span>earned from resales</span></div><div className="bar large"><i style={{ width: '68%' }} /></div><div className="legend"><span><i className="dot coral-dot" /> Received</span><span>68% of target</span></div></section></div></main> }
function Metric({ label, value, detail }) { return <div className="metric"><span className="label">{label}</span><strong>{value}</strong><small>{detail}</small></div> }

function DemoRegisterLegacy({ onRegister }) { const [form, setForm] = useState({ name: '', price: '', royalty: '8', category: 'Agritech' }); const [file, setFile] = useState(null); const navigate = useNavigate(); function submit(e) { e.preventDefault(); if (!form.name || !form.price) return; onRegister({ id: Date.now(), ...form, inventor: 'Connected wallet', inventorWallet: demoAddress, owner: 'Connected wallet', ownerWallet: demoAddress, originalPrice: Number(form.price), price: Number(form.price), royalty: Number(form.royalty), cid: file ? `pending-${file.name}` : 'QmDemoPatentDocument', status: 'First sale', resales: 0, earned: 0, color: 'mint' }); navigate('/marketplace'); } return <main className="page-wrap form-page"><div className="form-intro"><span className="eyebrow">CREATE AN ASSET</span><h2>Register your<br /><em>invention.</em></h2><p>Anchor a patent's digital record on-chain. The original inventor wallet stays attached to every future resale.</p></div><form className="form-panel" onSubmit={submit}><div className="form-section"><span className="section-number">01</span><div><h3>Patent details</h3><p>Use fictional or demo data for this academic prototype.</p></div></div><label>Patent name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. AI-Based Crop Disease Detection" /></label><div className="two-col"><label>Sector<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Agritech</option><option>Hardware</option><option>Materials</option><option>Software</option></select></label><label>Original price (ETH)<input required type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="1.50" /></label></div><div className="form-section second"><span className="section-number">02</span><div><h3>Resale agreement</h3><p>This percentage is enforced by the smart contract.</p></div></div><label>Inventor resale royalty <div className="input-suffix"><input required type="number" min="0" max="25" value={form.royalty} onChange={(e) => setForm({ ...form, royalty: e.target.value })} /><span>%</span></div></label><label className="upload">Patent document <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files[0])} /><span><b>↑</b>{file ? file.name : 'Drop a PDF here or browse'}<small>Only the IPFS content identifier is stored on-chain</small></span></label><button className="button primary full" type="submit">Register patent <span>→</span></button></form></main> }

function Details({ patents, onBuy, onList }) { const { id } = useParams(); const patent = patents.find((item) => String(item.id) === id) || patents[0]; const [price, setPrice] = useState(''); return <main className="page-wrap details-page"><Link to="/marketplace" className="back">← Back to marketplace</Link><div className="details-head"><div className={`detail-art ${patent.color}`}><span>PAT-{String(patent.id).padStart(3, '0')}</span><strong>{patent.id === 1 ? '◌' : '✳'}</strong></div><div><span className="eyebrow">PAT-{String(patent.id).padStart(3, '0')} · {patent.category}</span><h2>{patent.name}</h2><p>Registered asset with programmable resale royalty.</p></div><span className="pill green">{patent.status}</span></div><div className="details-layout"><section><div className="detail-panel"><span className="eyebrow">ASSET OVERVIEW</span><div className="facts"><Fact label="Original inventor" value={patent.inventor} /><Fact label="Current owner" value={patent.owner} /><Fact label="Original price" value={money(patent.originalPrice)} /><Fact label="Resale royalty" value={`${patent.royalty}%`} /></div><div className="cid"><span>IPFS DOCUMENT</span><strong>{patent.cid}</strong><a href={`https://ipfs.io/ipfs/${patent.cid}`} target="_blank" rel="noreferrer">View document ↗</a></div></div><div className="detail-panel"><span className="eyebrow">OWNERSHIP TIMELINE</span><div className="timeline"><Timeline title={patent.inventor} meta="Original registration · 2025" /><Timeline title={patent.owner} meta={`Current owner · ${patent.resales} transfer${patent.resales === 1 ? '' : 's'}`} active /></div></div></section><aside className="buy-panel"><span className="eyebrow">CURRENT LISTING</span><strong>{patent.price ? money(patent.price) : 'Not listed'}</strong><span className="sale-note">{patent.price ? `Includes ${patent.royalty}% inventor royalty` : 'Owner has not listed this patent'}</span>{patent.price > 0 && patent.status !== 'Owned' && <button className="button primary full" onClick={() => onBuy(patent.id)}>Buy with wallet <span>→</span></button>}<div className="resell"><span>Current owner?</span><div className="inline-input"><input placeholder="Resale price" value={price} onChange={(e) => setPrice(e.target.value)} /><button onClick={() => price && onList(patent.id, Number(price))}>List</button></div></div><div className="demo-note"><span>⌁</span><p>Demo mode is active. Configure `VITE_CONTRACT_ADDRESS` to send real testnet transactions.</p></div></aside></div></main> }
function Fact({ label, value }) { return <div><small>{label}</small><strong>{value}</strong></div> }
function Timeline({ title, meta, active }) { return <div className={`timeline-item ${active ? 'active' : ''}`}><span className="timeline-dot" /><div><strong>{title}</strong><small>{meta}</small></div><span className="timeline-check">✓</span></div> }
function VerificationPage({ wallet }) {
  const [form, setForm] = useState({ fullName: '', organization: '', idType: 'Patent filing record', idLast4: '', filingNumber: '', statement: '' });
  const [status, setStatus] = useState('');
  async function submit(event) {
    event.preventDefault();
    const token = sessionStorage.getItem('patentchain_token');
    if (!token || !wallet) return setStatus('Connect and sign in as a buyer first.');
    try {
      const message = `I, ${form.fullName}, declare I am the inventor of the patent(s) I register from wallet ${wallet}. This is a prototype declaration.`;
      const signature = await (new BrowserProvider(window.ethereum)).getSigner().then((signer) => signer.signMessage(message));
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/verification`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, message, signature, statement: form.statement || message }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Verification request failed');
      setStatus('Verification request submitted. An admin must review it before inventor access is enabled.');
    } catch (error) { setStatus(error.message); }
  }
  return <main className="page-wrap form-page"><div className="form-intro"><span className="eyebrow">INVENTOR VERIFICATION</span><h2>Prove your<br /><em>claim.</em></h2><p>Your wallet proves account control. An admin reviews this declaration and official filing details before granting inventor permissions.</p></div><form className="form-panel" onSubmit={submit}><label>Full name<input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label><label>Organization<input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></label><div className="two-col"><label>ID type<select value={form.idType} onChange={(e) => setForm({ ...form, idType: e.target.value })}><option>Patent filing record</option><option>University ID</option><option>Government ID</option></select></label><label>Last 4 characters<input required maxLength="4" value={form.idLast4} onChange={(e) => setForm({ ...form, idLast4: e.target.value })} /></label></div><label>Official filing number<input required value={form.filingNumber} onChange={(e) => setForm({ ...form, filingNumber: e.target.value })} placeholder="Demo filing number" /></label><label>Declaration<textarea required value={form.statement} onChange={(e) => setForm({ ...form, statement: e.target.value })} placeholder="Explain your inventor claim" /></label><button className="button primary full" type="submit">Sign and submit request <span>→</span></button>{status && <p className="sale-note">{status}</p>}</form></main>;
}
function AdminPage({ wallet }) {
  const [requests, setRequests] = useState([]); const [status, setStatus] = useState('');
  async function load() { const token = sessionStorage.getItem('patentchain_token'); const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/admin/verifications?status=pending`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); setRequests(Array.isArray(result) ? result : []); }
  useEffect(() => { if (wallet) load().catch((error) => setStatus(error.message)); }, [wallet]);
  async function decide(request, decision) { try { const token = sessionStorage.getItem('patentchain_token'); let txHash = ''; if (decision === 'verified') { const contract = await signerContract(); const tx = await contract.setInventorVerified(request.address, true); setStatus(`Verification transaction pending: ${tx.hash.slice(0, 12)}...`); await tx.wait(); txHash = tx.hash; } const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/admin/verifications/${request._id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, txHash }) }); if (!response.ok) throw new Error((await response.json()).error || 'Could not update verification'); setStatus(`Request ${decision}.`); load(); } catch (error) { setStatus(error.shortMessage || error.message); } }
  return <main className="page-wrap"><div className="page-heading compact"><div><span className="eyebrow">ADMIN CONSOLE</span><h2>Verification<br /><em>queue.</em></h2></div></div><div className="panel">{status && <p className="sale-note">{status}</p>}{requests.length === 0 ? <p className="sale-note">No pending inventor requests.</p> : requests.map((request) => <div className="portfolio-row" key={request._id}><span className="portfolio-name"><strong>{request.fullName}</strong><small>{request.address} · {request.filingNumber}</small></span><button className="button primary" onClick={() => decide(request, 'verified')}>Approve</button><button className="button secondary" onClick={() => decide(request, 'rejected')}>Reject</button></div>)}</div></main>;
}
function History({ patents }) { return <main className="page-wrap"><div className="page-heading compact"><div><span className="eyebrow">THE LEDGER</span><h2>Every move,<br /><em>accounted for.</em></h2></div><span className="pill outline">All activity</span></div><div className="history-panel">{patents.flatMap((patent, index) => [{ patent, from: patent.inventor, to: patent.owner, price: patent.originalPrice, type: 'Initial registration' }, ...(patent.resales ? [{ patent, from: 'Company A', to: patent.owner, price: patent.price, type: 'Resale royalty distributed' }] : [])]).map((record, index) => <div className="history-row" key={`${record.patent.id}-${index}`}><span className={`tiny-art ${record.patent.color}`}>{record.patent.name[0]}</span><div className="history-main"><strong>{record.type}</strong><small>PAT-{String(record.patent.id).padStart(3, '0')} · {record.from} <b>→</b> {record.to}</small></div><div className="history-price"><strong>{money(record.price)}</strong><small>{record.type === 'Resale royalty distributed' ? `${record.patent.royalty}% royalty` : 'Ownership recorded'}</small></div><span className="confirmed">Confirmed</span></div>)}</div></main> }