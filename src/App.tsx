/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileUp, 
  ShieldCheck, 
  Copy, 
  Check, 
  X, 
  FileText, 
  RefreshCw,
  Info,
  Database,
  ExternalLink,
  History,
  Search,
  AlertCircle,
  Plus,
  Trash2,
  Layers,
  ChevronRight,
  GitBranch
} from 'lucide-react';
import { generateSHA256, formatFileSize } from './utils/hash';
import { 
  recordHashOnChain, 
  recordHashesOnChain,
  verifyHashOnChain, 
  AMOY_CONFIG,
  HASH_REGISTRY_ADDRESS
} from './utils/blockchain';
import { calculateMerkleRoot, getStoredLeaves, saveLeaves, clearStoredLeaves } from './utils/merkle';

interface FileData {
  id: string;
  file: File;
  hash: string | null;
  loading: boolean;
  error: string | null;
  blockchainStatus: 'idle' | 'recording' | 'recorded' | 'verifying' | 'verified' | 'not-found' | 'error';
  txHash?: string;
  timestamp?: number;
}

export default function App() {
  const [filesData, setFilesData] = useState<FileData[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'workspace' | 'verify'>('workspace');
  const [verifyInput, setVerifyInput] = useState('');
  const [batchStatus, setBatchStatus] = useState<'idle' | 'recording' | 'recorded' | 'error'>('idle');
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchTxHash, setBatchTxHash] = useState<string | null>(null);
  
  const [verifyResult, setVerifyResult] = useState<{
    hash: string;
    timestamp: number | null;
    loading: boolean;
    error: string | null;
  } | null>(null);

  // Merkle Tree State
  const [allLeaves, setAllLeaves] = useState<string[]>([]);
  const [merkleRoot, setMerkleRoot] = useState<string | null>(null);
  const [isCalculatingRoot, setIsCalculatingRoot] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load stored leaves on mount
  useEffect(() => {
    const stored = getStoredLeaves();
    if (stored.length > 0) {
      setAllLeaves(stored);
      updateMerkleRoot(stored);
    }
  }, []);

  const updateMerkleRoot = async (leaves: string[]) => {
    setIsCalculatingRoot(true);
    try {
      const root = await calculateMerkleRoot(leaves);
      setMerkleRoot(root);
    } catch (err) {
      console.error('Error calculating Merkle Root:', err);
    } finally {
      setIsCalculatingRoot(false);
    }
  };

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const newFiles = Array.from(files).map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      hash: null,
      loading: true,
      error: null,
      blockchainStatus: 'idle' as const
    }));

    setFilesData(prev => [...prev, ...newFiles]);

    // Process each file
    for (const fileItem of newFiles) {
      try {
        const hash = await generateSHA256(fileItem.file);
        setFilesData(prev => prev.map(f => f.id === fileItem.id ? { ...f, hash, loading: false } : f));
        
        // Add to Merkle Tree leaves
        setAllLeaves(prev => {
          const updated = [...prev, hash];
          saveLeaves(updated);
          updateMerkleRoot(updated);
          return updated;
        });
      } catch (err) {
        setFilesData(prev => prev.map(f => f.id === fileItem.id ? { 
          ...f, 
          loading: false, 
          error: 'Failed to generate hash.',
          blockchainStatus: 'error'
        } : f));
        console.error(err);
      }
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const removeFile = (id: string) => {
    setFilesData(prev => prev.filter(f => f.id !== id));
  };

  const clearWorkspace = () => {
    setFilesData([]);
    setBatchStatus('idle');
    setBatchError(null);
    setBatchTxHash(null);
    
    // Clear Merkle Tree
    setAllLeaves([]);
    setMerkleRoot(null);
    clearStoredLeaves();

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const recordMerkleRootOnBlockchain = async () => {
    if (!merkleRoot) return;
    
    setBatchStatus('recording');
    setBatchError(null);
    setBatchTxHash(null);

    try {
      const txHash = await recordHashOnChain(merkleRoot);
      setBatchTxHash(txHash);
      setBatchStatus('recorded');
    } catch (err: any) {
      setBatchError(err.message || 'Failed to record Merkle Root.');
      setBatchStatus('error');
    }
  };

  const recordBatchOnBlockchain = async () => {
    const readyHashes = filesData
      .filter(f => f.hash && f.blockchainStatus === 'idle')
      .map(f => f.hash!);

    if (readyHashes.length === 0) return;

    if (!window.ethereum) {
      setBatchError('MetaMask not detected. Please try opening in a new tab.');
      setBatchStatus('error');
      return;
    }

    setBatchStatus('recording');
    setBatchError(null);
    
    try {
      const txHash = await recordHashesOnChain(readyHashes);
      setBatchTxHash(txHash);
      setBatchStatus('recorded');
      
      // Update individual file statuses
      setFilesData(prev => prev.map(f => 
        readyHashes.includes(f.hash!) 
          ? { ...f, blockchainStatus: 'recorded', txHash } 
          : f
      ));
    } catch (err: any) {
      console.error(err);
      setBatchError(err.message || 'Batch transaction failed.');
      setBatchStatus('error');
    }
  };

  const recordSingleOnBlockchain = async (id: string) => {
    const fileItem = filesData.find(f => f.id === id);
    if (!fileItem?.hash) return;

    setFilesData(prev => prev.map(f => f.id === id ? { ...f, blockchainStatus: 'recording' } : f));
    
    try {
      const txHash = await recordHashOnChain(fileItem.hash);
      setFilesData(prev => prev.map(f => f.id === id ? { 
        ...f, 
        blockchainStatus: 'recorded', 
        txHash 
      } : f));
    } catch (err: any) {
      setFilesData(prev => prev.map(f => f.id === id ? { 
        ...f, 
        blockchainStatus: 'error',
        error: err.message || 'Transaction failed.'
      } : f));
    }
  };

  const verifyOnBlockchain = async (hashToVerify: string, id?: string) => {
    const hash = hashToVerify.trim();
    if (!hash) return;

    if (id) {
      setFilesData(prev => prev.map(f => f.id === id ? { ...f, blockchainStatus: 'verifying' } : f));
    } else {
      setVerifyResult({ hash, timestamp: null, loading: true, error: null });
    }

    try {
      const timestamp = await verifyHashOnChain(hash);
      if (id) {
        setFilesData(prev => prev.map(f => f.id === id ? { 
          ...f, 
          blockchainStatus: timestamp ? 'verified' : 'not-found',
          timestamp: timestamp || undefined
        } : f));
      } else {
        setVerifyResult({ hash, timestamp, loading: false, error: null });
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Verification failed.';
      if (id) {
        setFilesData(prev => prev.map(f => f.id === id ? { ...f, blockchainStatus: 'error', error: errorMessage } : f));
      } else {
        setVerifyResult(prev => prev ? { ...prev, loading: false, error: errorMessage } : null);
      }
    }
  };

  const idleFilesCount = useMemo(() => 
    filesData.filter(f => f.blockchainStatus === 'idle' && f.hash).length, 
  [filesData]);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#202124] font-sans selection:bg-[#E8F0FE]">
      <div className="max-w-4xl mx-auto px-6 py-12 md:py-20">
        {/* Header */}
        <header className="mb-12 text-center">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center justify-center p-3 mb-6 bg-white rounded-2xl shadow-sm border border-[#E0E3E7]"
          >
            <ShieldCheck className="w-8 h-8 text-[#1A73E8]" />
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
          >
            Hash Workspace
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[#5F6368] text-lg max-w-xl mx-auto"
          >
            Upload multiple files, generate hashes, and record them all in a single blockchain transaction for maximum efficiency.
          </motion.p>
        </header>

        {/* Tabs */}
        <div className="flex justify-center mb-8">
          <div className="bg-white p-1 rounded-2xl shadow-sm border border-[#E0E3E7] flex">
            <button
              onClick={() => setActiveTab('workspace')}
              className={`px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'workspace' ? 'bg-[#1A73E8] text-white shadow-md' : 'text-[#5F6368] hover:bg-[#F1F3F4]'}`}
            >
              <Layers className="w-4 h-4" />
              Workspace {filesData.length > 0 && <span className="bg-white/20 px-1.5 rounded text-[10px]">{filesData.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('verify')}
              className={`px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'verify' ? 'bg-[#1A73E8] text-white shadow-md' : 'text-[#5F6368] hover:bg-[#F1F3F4]'}`}
            >
              <Search className="w-4 h-4" />
              Verify on Chain
            </button>
          </div>
        </div>

        <main>
          <AnimatePresence mode="wait">
            {activeTab === 'workspace' ? (
              <motion.div
                key="workspace-tab"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                {/* Upload Area */}
                <div
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`
                    relative group cursor-pointer
                    border-2 border-dashed rounded-3xl p-8 md:p-12
                    transition-all duration-300 ease-in-out
                    flex flex-col items-center justify-center text-center
                    ${isDragging 
                      ? 'border-[#1A73E8] bg-[#E8F0FE]' 
                      : 'border-[#DADCE0] bg-white hover:border-[#1A73E8] hover:bg-[#F1F3F4]'
                    }
                  `}
                >
                  <input 
                    type="file" 
                    multiple
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={onFileChange}
                  />
                  
                  <div className={`
                    p-4 rounded-full mb-4 transition-colors duration-300
                    ${isDragging ? 'bg-[#1A73E8] text-white' : 'bg-[#F1F3F4] text-[#5F6368] group-hover:bg-[#E8F0FE] group-hover:text-[#1A73E8]'}
                  `}>
                    <Plus className="w-8 h-8" />
                  </div>
                  
                  <h3 className="text-lg font-semibold mb-1">
                    {isDragging ? 'Drop files here' : 'Add files to workspace'}
                  </h3>
                  <p className="text-[#5F6368] text-sm">
                    Drag and drop multiple files, or click to browse
                  </p>
                </div>

                {/* Merkle Tree Info */}
                {allLeaves.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-[#F8F9FA] p-6 rounded-3xl border border-[#E0E3E7] space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[#1A73E8]">
                        <GitBranch className="w-5 h-5" />
                        <h4 className="font-bold text-sm uppercase tracking-wider">Merkle Tree Workspace</h4>
                      </div>
                      <div className="text-[10px] font-mono text-[#5F6368] bg-white px-2 py-1 rounded border border-[#DADCE0]">
                        Leaves: {allLeaves.length}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-[#5F6368] font-medium px-1">
                        <span>Current Merkle Root</span>
                        {isCalculatingRoot && <RefreshCw className="w-3 h-3 animate-spin" />}
                      </div>
                      <div className="bg-white p-4 rounded-2xl border border-[#DADCE0] flex items-center justify-between group/root">
                        <code className="text-xs font-mono text-[#202124] break-all">
                          {merkleRoot || 'Calculating...'}
                        </code>
                        {merkleRoot && (
                          <div className="flex items-center gap-2 ml-4">
                            <button
                              onClick={() => copyToClipboard(merkleRoot, 'merkle-root')}
                              className="p-2 hover:bg-[#F1F3F4] rounded-lg transition-colors text-[#5F6368]"
                              title="Copy Merkle Root"
                            >
                              {copied === 'merkle-root' ? <Check className="w-4 h-4 text-[#1E8E3E]" /> : <Copy className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={recordMerkleRootOnBlockchain}
                              disabled={batchStatus === 'recording'}
                              className="px-4 py-2 bg-[#1A73E8] text-white text-xs font-bold rounded-xl hover:bg-[#185ABC] transition-all shadow-sm flex items-center gap-2"
                            >
                              <Database className="w-3 h-3" />
                              Record Root
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-[#5F6368] px-1 italic">
                        The Merkle Root represents the entire state of your workspace. Recording it on-chain provides a single proof for all files.
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* Batch Actions */}
                {filesData.length > 0 && (
                  <div className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-[#E0E3E7]">
                    <div className="flex items-center gap-4">
                      <div className="text-sm font-medium text-[#5F6368]">
                        <span className="text-[#202124] font-bold">{filesData.length}</span> files in workspace
                      </div>
                      {idleFilesCount > 0 && (
                        <div className="px-2 py-0.5 bg-[#E8F0FE] text-[#1A73E8] text-[10px] font-bold rounded uppercase">
                          {idleFilesCount} Ready to record
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={clearWorkspace}
                        className="px-4 py-2 text-sm font-semibold text-[#D93025] hover:bg-[#FCE8E6] rounded-xl transition-all flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        Clear All
                      </button>
                      <button
                        onClick={recordBatchOnBlockchain}
                        disabled={idleFilesCount === 0 || batchStatus === 'recording'}
                        className="px-6 py-2 bg-[#1A73E8] text-white rounded-xl font-semibold hover:bg-[#185ABC] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md flex items-center gap-2"
                      >
                        {batchStatus === 'recording' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                        Record All in One Transaction
                      </button>
                    </div>
                  </div>
                )}

                {/* Batch Status Messages */}
                {batchStatus === 'recorded' && batchTxHash && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-[#E6F4EA] p-4 rounded-2xl border border-[#CEEAD6] flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <Check className="w-5 h-5 text-[#1E8E3E]" />
                      <span className="text-[#137333] font-medium">Batch successfully recorded!</span>
                    </div>
                    <a 
                      href={`${AMOY_CONFIG.blockExplorerUrls[0]}tx/${batchTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#1A73E8] text-xs font-mono flex items-center gap-1 hover:underline"
                    >
                      View Transaction <ExternalLink className="w-3 h-3" />
                    </a>
                  </motion.div>
                )}

                {batchStatus === 'error' && batchError && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-[#FCE8E6] p-4 rounded-2xl border border-[#FAD2CF] flex items-center gap-3 text-[#D93025]"
                  >
                    <AlertCircle className="w-5 h-5" />
                    <span className="font-medium">{batchError}</span>
                  </motion.div>
                )}

                {/* File List */}
                <div className="space-y-3">
                  <AnimatePresence>
                    {filesData.map((fileItem) => (
                      <motion.div
                        key={fileItem.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white rounded-2xl shadow-sm border border-[#E0E3E7] overflow-hidden group"
                      >
                        <div className="p-4 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className="p-2 bg-[#F1F3F4] rounded-lg text-[#5F6368] group-hover:bg-[#E8F0FE] group-hover:text-[#1A73E8] transition-colors">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-sm truncate">{fileItem.file.name}</h4>
                              <div className="flex items-center gap-2 text-[10px] text-[#70757A] font-medium uppercase tracking-wider">
                                <span>{formatFileSize(fileItem.file.size)}</span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  {fileItem.loading ? (
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <>Hash: {fileItem.hash?.slice(0, 10)}...</>
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            {/* Status Badge */}
                            {fileItem.blockchainStatus === 'recorded' && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#E6F4EA] text-[#137333] text-[10px] font-bold rounded-full uppercase">
                                <Check className="w-3 h-3" />
                                Recorded
                              </div>
                            )}
                            {fileItem.blockchainStatus === 'recording' && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#E8F0FE] text-[#1A73E8] text-[10px] font-bold rounded-full uppercase">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Recording
                              </div>
                            )}
                            {fileItem.blockchainStatus === 'error' && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#FCE8E6] text-[#D93025] text-[10px] font-bold rounded-full uppercase">
                                <AlertCircle className="w-3 h-3" />
                                Error
                              </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-1 border-l border-[#E0E3E7] pl-3">
                              {fileItem.hash && (
                                <button
                                  onClick={() => copyToClipboard(fileItem.hash!, fileItem.id)}
                                  className={`p-2 rounded-lg transition-all ${copied === fileItem.id ? 'bg-[#34A853] text-white' : 'hover:bg-[#F1F3F4] text-[#5F6368]'}`}
                                  title="Copy Hash"
                                >
                                  {copied === fileItem.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                </button>
                              )}
                              {fileItem.blockchainStatus === 'idle' && fileItem.hash && (
                                <button
                                  onClick={() => recordSingleOnBlockchain(fileItem.id)}
                                  className="p-2 hover:bg-[#E8F0FE] text-[#1A73E8] rounded-lg transition-all"
                                  title="Record Single"
                                >
                                  <Database className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => removeFile(fileItem.id)}
                                className="p-2 hover:bg-[#FCE8E6] text-[#D93025] rounded-lg transition-all"
                                title="Remove"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                        
                        {/* Error Detail */}
                        {fileItem.error && (
                          <div className="px-4 pb-3 text-[10px] text-[#D93025] font-medium flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {fileItem.error}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  
                  {filesData.length === 0 && (
                    <div className="text-center py-12 text-[#5F6368]">
                      <Layers className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p>Your workspace is empty. Add some files to get started.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="verify-tab"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white rounded-3xl shadow-lg border border-[#E0E3E7] p-8"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-bold">Verify Hash Integrity</h3>
                </div>
                <p className="text-[#5F6368] mb-8">
                  Enter a SHA-256 hash to check if it has been recorded on the Polygon Amoy Testnet.
                </p>

                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-[#70757A] uppercase tracking-widest mb-2">
                      SHA-256 Hash
                    </label>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={verifyInput}
                        onChange={(e) => setVerifyInput(e.target.value)}
                        placeholder="e.g. 5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
                        className="flex-1 px-4 py-3 bg-[#F1F3F4] rounded-xl border-2 border-transparent focus:border-[#1A73E8] focus:bg-white outline-none font-mono text-sm transition-all"
                      />
                      <button
                        onClick={() => verifyOnBlockchain(verifyInput)}
                        disabled={!verifyInput || verifyResult?.loading}
                        className="px-6 py-3 bg-[#1A73E8] text-white rounded-xl font-semibold hover:bg-[#185ABC] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                      >
                        {verifyResult?.loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        Verify
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {verifyResult && !verifyResult.loading && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`p-6 rounded-2xl border ${verifyResult.timestamp ? 'bg-[#E6F4EA] border-[#CEEAD6]' : 'bg-[#F1F3F4] border-[#DADCE0]'}`}
                      >
                        {verifyResult.error ? (
                          <div className="flex items-center gap-3 text-[#A50E0E]">
                            <AlertCircle className="w-5 h-5" />
                            <p className="font-medium">{verifyResult.error}</p>
                          </div>
                        ) : verifyResult.timestamp ? (
                          <>
                            <div className="flex items-center gap-3 mb-4">
                              <div className="p-2 bg-white rounded-lg text-[#1E8E3E]">
                                <Check className="w-5 h-5" />
                              </div>
                              <h5 className="font-bold text-[#137333]">Verified Record Found</h5>
                            </div>
                            <div className="space-y-4">
                              <div>
                                <span className="text-xs font-bold text-[#5F6368] uppercase tracking-wider block mb-1">Timestamp</span>
                                <p className="text-lg font-bold text-[#202124]">
                                  {new Date(verifyResult.timestamp * 1000).toLocaleString()}
                                </p>
                              </div>
                              <div className="p-3 bg-white/50 rounded-xl border border-[#CEEAD6]">
                                <span className="text-xs font-bold text-[#5F6368] uppercase tracking-wider block mb-1">Hash Verification</span>
                                <p className="text-xs font-mono break-all text-[#137333]">
                                  {verifyResult.hash}
                                </p>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-3 text-[#5F6368]">
                            <AlertCircle className="w-5 h-5" />
                            <div>
                              <h5 className="font-bold text-[#202124]">No Record Found</h5>
                              <p className="text-sm">This hash has not been recorded on the blockchain yet, or it was recorded on a different contract.</p>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Footer Info */}
        <footer className="mt-16 text-center text-[#70757A] text-sm">
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#34A853]"></div>
              Batch Processing
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#1A73E8]"></div>
              Polygon Amoy Testnet
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#F9AB00]"></div>
              Immutable Proof
            </div>
          </div>
          
          <div className="mt-8 p-6 bg-white rounded-2xl border border-[#E0E3E7] inline-block max-w-2xl mx-auto text-left">
            <h5 className="font-bold text-xs uppercase tracking-widest mb-3 text-[#202124]">Smart Contract Update Required</h5>
            <p className="text-xs leading-relaxed text-[#5F6368] mb-4">
              To use the <strong>Batch Recording</strong> feature, your smart contract must include the <code>recordHashes</code> function. Copy the code below and redeploy if you haven't already:
            </p>
            <div className="bg-[#F1F3F4] p-4 rounded-xl font-mono text-[10px] overflow-x-auto border border-[#DADCE0]">
              <pre>{`function recordHashes(bytes32[] memory _hashes) public {
    for (uint i = 0; i < _hashes.length; i++) {
        recordHash(_hashes[i]);
    }
}`}</pre>
            </div>
            <div className="mt-4 pt-4 border-t border-[#F1F3F4] flex items-center justify-between">
              <span className="text-[10px] font-medium">Contract: <code className="bg-[#F1F3F4] px-1 rounded">{HASH_REGISTRY_ADDRESS}</code></span>
              <a href="https://faucet.polygon.technology/" target="_blank" rel="noopener noreferrer" className="text-[#1A73E8] text-[10px] font-bold hover:underline flex items-center gap-1">
                Get MATIC Faucet <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
