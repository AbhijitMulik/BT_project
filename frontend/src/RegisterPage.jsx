import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseEther } from 'ethers';
import { contractAddress, signerContract } from './lib/market';

export default function RegisterPage({ wallet }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', abstract: '', price: '', royalty: '8', category: 'Agritech' });
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [step, setStep] = useState('');

  async function submit(event) {
    event.preventDefault();
    const token = sessionStorage.getItem('patentchain_token');
    if (!wallet || !token) return setStatus('Connect MetaMask and sign in first.');
    if (!contractAddress) return setStatus('Contract not found. Run deployment and restart Vite.');
    if (!file) return setStatus('Upload a patent PDF before registering.');
    try {
      setStep('Uploading document to IPFS');
      const body = new FormData();
      body.append('file', file);
      const uploadResponse = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/ipfs/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
      const upload = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(upload.error || 'Document upload failed');
      setStep('Waiting for MetaMask registration signature');
      const contract = await signerContract();
      const royaltyBps = Math.round(Number(form.royalty) * 100);
      const tx = await contract.registerPatent(form.name, parseEther(form.price), royaltyBps, upload.cid);
      setStep(`Confirming transaction ${tx.hash.slice(0, 12)}...`);
      const receipt = await tx.wait();
      const patentId = Number(await contract.patentCount());
      const metadataResponse = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/patents/meta`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ patentId, cid: upload.cid, title: form.name, abstract: form.abstract, category: form.category, txHash: tx.hash }) });
      if (!metadataResponse.ok) throw new Error('Patent registered, but metadata saving failed. Retry metadata from the admin/API flow.');
      setStep('');
      setStatus('Patent registered and submitted for admin approval.');
      setTimeout(() => navigate(`/patent/${patentId}`), 900);
    } catch (error) { setStep(''); setStatus(error.shortMessage || error.message || 'Registration failed.'); }
  }

  return <main className="page-wrap form-page"><div className="form-intro"><span className="eyebrow">CREATE AN ASSET</span><h2>Register your<br /><em>invention.</em></h2><p>Upload first, then sign the registration transaction. A verified admin must approve the patent before it appears for sale.</p></div><form className="form-panel" onSubmit={submit}><label>Patent name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="AI-Based Crop Disease Detection" /></label><label>Abstract<textarea required value={form.abstract} onChange={(event) => setForm({ ...form, abstract: event.target.value })} placeholder="Short public description" /></label><div className="two-col"><label>Sector<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Agritech</option><option>Hardware</option><option>Materials</option><option>Software</option></select></label><label>Original price (ETH)<input required min="0" step="0.01" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label></div><label>Resale royalty percentage<input required min="0" max="25" step="0.5" type="number" value={form.royalty} onChange={(event) => setForm({ ...form, royalty: event.target.value })} /></label><label className="upload">Patent PDF<input required type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} /><span><b>↑</b>{file ? file.name : 'Choose a PDF document'}<small>Maximum 10 MB. Only the CID is written on-chain.</small></span></label><button className="button primary full" type="submit">Upload and register <span>→</span></button>{step && <p className="sale-note">{step}</p>}{status && <p className="sale-note">{status}</p>}</form></main>;
}