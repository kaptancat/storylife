
import React, { useState, useEffect, useRef } from 'react';
import { Grade, Student, Evaluation, SavedReport, AppState } from './types';
import { analyzeStudentWork, compareStudentsForPlagiarism } from './services/gemini';
import { PDFGenerator } from './components/PDFGenerator';
import { saveToDB, getFromDB } from './storage';
import { 
  Radar, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  ResponsiveContainer,
  Legend,
  Tooltip
} from 'recharts';

const App: React.FC = () => {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [referenceText, setReferenceText] = useState('');
  
  const [activeGradeId, setActiveGradeId] = useState<string | null>(null);
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [viewingSavedReport, setViewingSavedReport] = useState<SavedReport | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'main' | 'records' | 'compare'>('main');
  const [isLoaded, setIsLoaded] = useState(false);
  const [isAppStarted, setIsAppStarted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedStudentIdsForComparison, setSelectedStudentIdsForComparison] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [isAddingGrade, setIsAddingGrade] = useState(false);
  const [newGradeName, setNewGradeName] = useState('');
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');

  // Sıkıştırma
  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1000;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.5));
      };
    });
  };

  useEffect(() => {
    const loadState = async () => {
      try {
        const data = await getFromDB('appData');
        if (data) {
          setGrades(data.grades || []);
          setStudents(data.students || []);
          setSavedReports(data.savedReports || []);
          setReferenceText(data.referenceText || '');
        }
        const hasSeenOnboarding = localStorage.getItem('hasSeenOnboarding');
        if (!hasSeenOnboarding) setShowOnboarding(true);
      } catch (e) {
        console.error("Yükleme hatası:", e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadState();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const saveState = async () => {
      try {
        await saveToDB('appData', { grades, students, savedReports, referenceText });
      } catch (e) {
        console.error("Kayıt hatası:", e);
      }
    };
    saveState();
  }, [grades, students, savedReports, referenceText, isLoaded]);

  const handleCloseOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem('hasSeenOnboarding', 'true');
  };

  const exportData = () => {
    const data: AppState = { grades, students, referenceText, savedReports };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Hikaye_Sistemi_Yedek_${new Date().toLocaleDateString().replace(/\//g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const data: AppState = JSON.parse(content);
          if (confirm('Mevcut verilerin üzerine yazılacak. Emin misiniz?')) {
            setGrades(data.grades || []);
            setStudents(data.students || []);
            setSavedReports(data.savedReports || []);
            setReferenceText(data.referenceText || '');
            alert('Yüklendi.');
          }
        } catch (err) { alert('Hata.'); }
      };
      reader.readAsText(file);
    }
  };

  const toggleStudentComparison = (id: string) => {
    setSelectedStudentIdsForComparison(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const handleAddGrade = (e: React.FormEvent) => {
    e.preventDefault();
    if (newGradeName.trim()) {
      const newGrade = { id: Date.now().toString(), name: newGradeName.trim() };
      setGrades(prev => [...prev, newGrade]);
      setNewGradeName('');
      setIsAddingGrade(false);
      setActiveGradeId(newGrade.id);
    }
  };

  const handleAddStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (newStudentName.trim() && activeGradeId) {
      const newStudent = { id: Date.now().toString(), name: newStudentName.trim(), gradeId: activeGradeId };
      setStudents(prev => [...prev, newStudent]);
      setNewStudentName('');
      setIsAddingStudent(false);
    }
  };

  const handleImageUpload = (studentId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const compressed = await compressImage(base64);
        setStudents(prev => prev.map(s => s.id === studentId ? { ...s, workImage: compressed } : s));
      };
      reader.readAsDataURL(file);
    }
  };

  const runAnalysis = async (student: Student) => {
    if (!student.workImage) return;
    setLoading(true);
    try {
      const gradeName = grades.find(g => g.id === student.gradeId)?.name || 'Bilinmiyor';
      const evaluation = await analyzeStudentWork(student.workImage, gradeName, referenceText);
      setStudents(prev => prev.map(s => s.id === student.id ? { ...s, evaluation } : s));
      setActiveStudentId(student.id);
    } catch (error) { alert('Hata.'); }
    finally { setLoading(false); }
  };

  const deleteGrade = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Sınıf silinsin mi?')) {
      setGrades(prev => prev.filter(g => g.id !== id));
      setStudents(prev => prev.filter(s => s.gradeId !== id));
      if (activeGradeId === id) setActiveGradeId(null);
    }
  };

  const saveToHistory = (student: Student, grade: Grade | undefined) => {
    if (!student.evaluation) return;
    const newReport: SavedReport = {
      id: Date.now().toString(),
      studentName: student.name,
      gradeName: grade?.name || 'Bilinmiyor',
      timestamp: new Date().toLocaleString(),
      evaluation: student.evaluation,
      workImage: student.workImage
    };
    setSavedReports(prev => [newReport, ...prev]);
    alert('Kaydedildi.');
  };

  const deleteSavedReport = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Silinsin mi?')) {
      setSavedReports(prev => prev.filter(r => r.id !== id));
      if (viewingSavedReport?.id === id) setViewingSavedReport(null);
    }
  };

  if (!isLoaded) return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-6">
      <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
      <p className="font-bold text-indigo-900 uppercase tracking-widest text-xs">Yükleniyor...</p>
    </div>
  );

  if (!isAppStarted) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center relative overflow-hidden px-6">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-100 rounded-full blur-[120px] opacity-60 animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-amber-50 rounded-full blur-[120px] opacity-60 animate-pulse"></div>
        <div className="max-w-4xl w-full text-center relative z-10 animate-in fade-in zoom-in duration-1000">
          <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-full mb-8">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span></span>
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Yapay Zeka Destekli Nesil</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-[800] text-slate-900 tracking-tight leading-[1.1] mb-6">Yaratıcı Hikaye Yazma <br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-indigo-400">Değerlendirme Sistemi</span></h1>
          <p className="text-slate-500 text-lg md:text-xl font-medium max-w-2xl mx-auto mb-12 leading-relaxed">Öğrencilerinizin hayal gücünü kağıda döktüğü anları analiz edin, el yazısını saniyeler içinde dijitalleştirin ve profesyonel gelişim raporları oluşturun.</p>
          <div className="relative w-full max-w-3xl mx-auto h-[300px] mb-12 group">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#F8FAFC] z-10"></div>
            <div className="absolute inset-0 border-2 border-white/50 rounded-[40px] shadow-2xl overflow-hidden transition-all duration-700 group-hover:scale-[1.02] bg-indigo-600 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 bg-white rounded-3xl mx-auto mb-4 flex items-center justify-center shadow-xl">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </div>
                <p className="text-white font-black uppercase tracking-[0.4em] text-xs opacity-50">SİSTEM VERSİYON 2.0</p>
              </div>
            </div>
          </div>
          <button onClick={() => setIsAppStarted(true)} className="bg-indigo-600 text-white px-12 py-5 rounded-3xl font-[800] text-lg tracking-wide shadow-2xl shadow-indigo-200 hover:bg-indigo-700 hover:-translate-y-1 transition-all flex items-center gap-4 mx-auto">UYGULAMAYI BAŞLAT <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M13 7l5 5-5 5M6 12h12" /></svg></button>
        </div>
      </div>
    );
  }

  const activeGrade = grades.find(g => g.id === activeGradeId);
  const activeStudent = students.find(s => s.id === activeStudentId);
  const studentsInActiveGrade = students.filter(s => s.gradeId === activeGradeId);
  const evaluatedStudents = studentsInActiveGrade.filter(s => s.evaluation);

  return (
    <div className="min-h-screen p-4 md:p-8 bg-[#F8FAFC] text-slate-900 animate-in fade-in duration-700 relative">
      
      {showOnboarding && (
        <div className="fixed top-24 right-8 z-[80] w-80 animate-in slide-in-from-right-10 fade-in duration-500">
          <div className="bg-indigo-600 text-white p-6 rounded-[32px] shadow-2xl relative border border-indigo-400">
            <button onClick={handleCloseOnboarding} className="absolute top-4 right-4 text-white/60 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
              <h4 className="font-black text-xs uppercase tracking-widest">Nasıl Kullanılır?</h4>
            </div>
            <div className="space-y-3 text-sm font-medium text-indigo-50">
              <p>1. Sol taraftan bir <span className="text-white font-bold">Sınıf</span> oluşturun.</p>
              <p>2. Sınıfa <span className="text-white font-bold">Öğrenci</span> ekleyin ve hikayesinin fotoğrafını yükleyin.</p>
              <p>3. <span className="text-white font-bold">Analiz</span> butonuna basın.</p>
              <p>4. <span className="text-white font-bold">Karşılaştırma</span> sekmesinden öğrencileri kıyaslayın.</p>
            </div>
          </div>
        </div>
      )}

      <header className="max-w-6xl mx-auto mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6 no-print">
        <div className="flex items-center gap-5">
          <div onClick={() => setIsAppStarted(false)} className="w-14 h-14 bg-indigo-600 rounded-[20px] flex items-center justify-center text-white shadow-xl shadow-indigo-100 transform -rotate-2 hover:rotate-0 transition-all cursor-pointer">
             <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </div>
          <div>
            <h1 className="text-2xl font-[800] tracking-tight text-slate-900 leading-none">Hikaye Yazma Sistemi</h1>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mt-2">Öğrenci Analiz & Değerlendirme</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex bg-white/60 backdrop-blur-md p-1.5 rounded-[22px] shadow-sm border border-slate-200">
            <button onClick={() => { setActiveTab('main'); setViewingSavedReport(null); }} className={`px-6 py-2.5 rounded-[18px] text-[10px] font-[800] uppercase tracking-wider transition-all ${activeTab === 'main' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>Analiz Paneli</button>
            <button onClick={() => setActiveTab('compare')} className={`px-6 py-2.5 rounded-[18px] text-[10px] font-[800] uppercase tracking-wider transition-all ${activeTab === 'compare' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>Karşılaştırma</button>
            <button onClick={() => setActiveTab('records')} className={`px-6 py-2.5 rounded-[18px] text-[10px] font-[800] uppercase tracking-wider transition-all ${activeTab === 'records' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>Arşiv</button>
          </div>
          
          <div className="flex gap-2">
            <button onClick={() => setShowOnboarding(true)} title="Yardım" className={`p-3 bg-white border border-slate-200 rounded-[16px] transition-all ${showOnboarding ? 'text-indigo-600 bg-indigo-50 border-indigo-100' : 'text-slate-500 hover:bg-slate-50'}`}><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>
            <button onClick={exportData} title="Yedekle" className="p-3 bg-white border border-slate-200 text-slate-500 rounded-[16px] hover:bg-slate-50 transition-all hover:text-indigo-600"><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>
            <button onClick={() => fileInputRef.current?.click()} title="Geri Yükle" className="p-3 bg-white border border-slate-200 text-slate-500 rounded-[16px] hover:bg-slate-50 transition-all hover:text-indigo-600"><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg></button>
            <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={importData} />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-8">
        {(activeTab === 'main' || activeTab === 'compare') && (
          <aside className="lg:col-span-1 space-y-6 no-print">
            <section className="bg-white p-7 rounded-[40px] shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-[800] text-slate-400 text-[10px] uppercase tracking-[0.2em]">Sınıflar</h2>
                <button onClick={() => setIsAddingGrade(true)} className="bg-indigo-50 text-indigo-600 p-2.5 rounded-[14px] hover:bg-indigo-100 transition-all"><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M12 4v16m8-8H4"/></svg></button>
              </div>
              {isAddingGrade && (
                <form onSubmit={handleAddGrade} className="mb-6 animate-in fade-in slide-in-from-top-2">
                  <input autoFocus type="text" placeholder="Sınıf İsmi..." className="w-full px-5 py-4 border-2 border-indigo-50 rounded-[20px] outline-none text-sm mb-2 focus:border-indigo-500" value={newGradeName} onChange={(e) => setNewGradeName(e.target.value)} />
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-indigo-600 text-white py-3 rounded-[16px] text-xs font-black">EKLE</button>
                    <button type="button" onClick={() => setIsAddingGrade(false)} className="px-5 py-3 bg-slate-100 text-slate-500 rounded-[16px] text-xs font-black">İPTAL</button>
                  </div>
                </form>
              )}
              <div className="space-y-2">
                {grades.map(grade => (
                  <div key={grade.id} className={`group flex items-center justify-between px-5 py-4 rounded-[20px] cursor-pointer transition-all border-2 ${activeGradeId === grade.id ? 'bg-indigo-50/50 border-indigo-500 text-indigo-700 shadow-sm' : 'text-slate-600 border-transparent hover:bg-slate-50'}`} onClick={() => { setActiveGradeId(grade.id); setActiveStudentId(null); setSelectedStudentIdsForComparison([]); }}>
                    <span className="font-bold text-sm truncate">{grade.name}</span>
                    <button onClick={(e) => deleteGrade(grade.id, e)} className="opacity-0 group-hover:opacity-100 p-2 text-slate-300 hover:text-rose-500 transition-all"><svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                  </div>
                ))}
              </div>
            </section>
            {activeTab === 'main' && (
              <section className="bg-white p-7 rounded-[40px] shadow-sm border border-slate-200">
                <h2 className="font-[800] text-slate-400 text-[10px] uppercase tracking-[0.2em] mb-4">Referans Metin</h2>
                <textarea className="w-full h-44 p-5 border-2 border-slate-50 rounded-[24px] text-sm outline-none resize-none bg-slate-50/50 font-medium focus:ring-2 focus:ring-indigo-100 transition-all" placeholder="Örnek metni girin..." value={referenceText} onChange={(e) => setReferenceText(e.target.value)} />
              </section>
            )}
          </aside>
        )}

        <section className={`${activeTab === 'records' ? 'lg:col-span-4' : 'lg:col-span-3'}`}>
          {activeGradeId ? (
            <>
              {activeTab === 'main' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 no-print bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
                    <div>
                      <h2 className="text-3xl font-black text-slate-800 tracking-tight">{activeGrade?.name}</h2>
                      <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mt-1">Öğrenci Analizleri</p>
                    </div>
                    {!isAddingStudent ? (
                      <button onClick={() => setIsAddingStudent(true)} className="bg-indigo-600 text-white px-8 py-4 rounded-[18px] text-xs font-[800] uppercase tracking-widest shadow-xl shadow-indigo-50 hover:bg-indigo-700 transition-all">Yeni Öğrenci Ekle</button>
                    ) : (
                      <form onSubmit={handleAddStudent} className="flex gap-2 animate-in zoom-in-95">
                        <input autoFocus type="text" placeholder="Ad Soyad..." className="px-6 py-4 border-2 border-indigo-100 rounded-[18px] outline-none text-sm w-56 shadow-inner focus:border-indigo-500" value={newStudentName} onChange={(e) => setNewStudentName(e.target.value)} />
                        <button type="submit" className="bg-indigo-600 text-white px-7 py-4 rounded-[18px] text-xs font-black uppercase">KAYDET</button>
                      </form>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 no-print">
                    {studentsInActiveGrade.map(student => (
                      <div key={student.id} onClick={() => setActiveStudentId(student.id)} className={`group p-8 rounded-[40px] border-2 transition-all duration-500 cursor-pointer flex flex-col justify-between relative overflow-hidden ${activeStudentId === student.id ? 'bg-white border-indigo-500 shadow-2xl scale-[1.02]' : 'bg-white border-transparent shadow-sm hover:shadow-md'}`}>
                        <div className="relative z-10">
                          <span className="font-[800] text-slate-800 truncate text-xl tracking-tight block mb-2">{student.name}</span>
                          <div className="flex items-center gap-2">
                             <div className={`w-2 h-2 rounded-full ${student.evaluation ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : (student.workImage ? 'bg-amber-500 animate-pulse' : 'bg-slate-200')}`} />
                             <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{student.evaluation ? 'Analiz Hazır' : (student.workImage ? 'Analiz Bekliyor' : 'Resim Bekliyor')}</span>
                          </div>
                        </div>
                        <div className="mt-10 flex gap-3 relative z-10">
                          <label className="flex-1 text-center bg-slate-50 text-slate-600 py-4 rounded-[18px] text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-slate-100 border border-slate-100 transition shadow-inner">Yükle<input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(student.id, e)} /></label>
                          {student.workImage && <button disabled={loading} onClick={(e) => { e.stopPropagation(); runAnalysis(student); }} className="flex-1 bg-indigo-50 text-indigo-700 py-4 rounded-[18px] text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition shadow-sm">{loading && activeStudentId === student.id ? '...' : 'ANALİZ'}</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {activeStudent && <EvaluationDetail student={activeStudent} grade={activeGrade} onSave={() => saveToHistory(activeStudent, activeGrade)} />}
                </div>
              )}

              {activeTab === 'compare' && (
                <div className="space-y-8 animate-in slide-in-from-right duration-500">
                  <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-200">
                    <h2 className="text-3xl font-black text-slate-800 tracking-tight mb-2">Gelişim Karşılaştırma</h2>
                    <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest">Aynı sınıftaki öğrencilerin performansını kıyaslayın</p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm max-h-[600px] overflow-y-auto custom-scrollbar">
                      <h3 className="font-black text-slate-400 text-[10px] uppercase tracking-widest mb-6">Öğrenci Seçimi</h3>
                      <div className="space-y-3">
                        {evaluatedStudents.map(student => (
                          <div 
                            key={student.id} 
                            onClick={() => toggleStudentComparison(student.id)}
                            className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all border-2 ${selectedStudentIdsForComparison.includes(student.id) ? 'bg-indigo-50 border-indigo-500' : 'bg-slate-50 border-transparent'}`}
                          >
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all ${selectedStudentIdsForComparison.includes(student.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200'}`}>
                              {selectedStudentIdsForComparison.includes(student.id) && <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M5 13l4 4L19 7"/></svg>}
                            </div>
                            <span className="font-bold text-sm text-slate-700">{student.name}</span>
                          </div>
                        ))}
                        {evaluatedStudents.length === 0 && <p className="text-xs text-slate-400 italic text-center py-10">Önce analiz yapılmış öğrencilere ihtiyacınız var.</p>}
                      </div>
                    </div>

                    <div className="lg:col-span-2 bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm flex flex-col items-center justify-center min-h-[500px]">
                      {selectedStudentIdsForComparison.length > 0 ? (
                        <div className="w-full h-full flex flex-col">
                           <h3 className="font-black text-slate-400 text-[10px] uppercase tracking-widest mb-4 text-center">Kıyaslama Grafiği</h3>
                           <div className="flex-1 w-full min-h-[400px]">
                             <ComparisonChart studentIds={selectedStudentIdsForComparison} students={students} />
                           </div>
                        </div>
                      ) : (
                        <div className="text-center space-y-4">
                           <div className="w-20 h-20 bg-indigo-50 rounded-3xl mx-auto flex items-center justify-center">
                             <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                           </div>
                           <p className="text-slate-400 font-bold text-sm">Karşılaştırmak için soldan öğrencileri seçin.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'records' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 animate-in slide-in-from-right duration-500">
                  <div className="lg:col-span-1 space-y-4">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-black text-slate-800 tracking-tight">Kayıt Arşivi</h2>
                      <span className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full text-[10px] font-black">{savedReports.length} KAYIT</span>
                    </div>
                    <div className="space-y-3 overflow-y-auto max-h-[75vh] pr-4 custom-scrollbar">
                      {savedReports.map(report => (
                        <div key={report.id} onClick={() => setViewingSavedReport(report)} className={`group p-6 rounded-[32px] border-2 transition-all cursor-pointer relative ${viewingSavedReport?.id === report.id ? 'bg-white border-indigo-500 shadow-xl scale-[1.02]' : 'bg-white border-transparent shadow-sm hover:shadow-md'}`}>
                          <button onClick={(e) => deleteSavedReport(report.id, e)} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-2 text-slate-300 hover:text-rose-500 transition-all"><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                          <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-indigo-100">{report.evaluation.overallScore}</div>
                            <div className="min-w-0">
                              <p className="font-[800] text-slate-800 truncate text-lg tracking-tight">{report.studentName}</p>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{report.gradeName} • {report.timestamp}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    {viewingSavedReport ? (
                      <EvaluationDetail isSavedView student={{...viewingSavedReport, id: viewingSavedReport.id, name: viewingSavedReport.studentName, gradeId: '', evaluation: viewingSavedReport.evaluation, workImage: viewingSavedReport.workImage}} grade={{id:'', name: viewingSavedReport.gradeName}} />
                    ) : <EmptyState icon="records" title="Kayıtları İncele" description="Arşivlenmiş raporları görmek için soldan seçim yapın." />}
                  </div>
                </div>
              )}
            </>
          ) : (
            <EmptyState icon="grade" title="Sınıf Seçiniz" description="Devam etmek için soldaki panelden bir sınıf seçin." />
          )}
        </section>
      </main>

      {loading && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl flex items-center justify-center z-[100] p-6">
          <div className="bg-white p-16 rounded-[60px] shadow-2xl flex flex-col items-center gap-10 text-center animate-in zoom-in-95 duration-500 max-w-sm">
            <div className="relative">
              <div className="w-32 h-32 border-[12px] border-slate-50 border-t-indigo-600 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-indigo-600 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg></div>
            </div>
            <div className="space-y-4">
              <h3 className="text-3xl font-[800] text-slate-900 tracking-tight">Analiz Yapılıyor</h3>
              <p className="text-sm text-slate-400 font-semibold leading-relaxed">Yapay zeka hikayeyi okuyor ve puanlıyor. Lütfen bekleyin...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// COMPARISON CHART COMPONENT
const ComparisonChart: React.FC<{ studentIds: string[], students: Student[] }> = ({ studentIds, students }) => {
  const chartData = [
    { subject: 'EL YAZISI' },
    { subject: 'ÖZGÜNLÜK' },
    { subject: 'YARATICILIK' },
    { subject: 'DİL BİLGİSİ' },
    { subject: 'GENEL PUAN' },
  ];

  const colors = [
    '#4F46E5', // Indigo
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#EF4444', // Rose
    '#8B5CF6', // Violet
    '#EC4899', // Pink
  ];

  const selectedStudents = students.filter(s => studentIds.includes(s.id) && s.evaluation);

  const finalData = chartData.map(item => {
    const newItem: any = { ...item };
    selectedStudents.forEach(student => {
      if (!student.evaluation) return;
      let val = 0;
      if (item.subject === 'EL YAZISI') val = student.evaluation.handwritingScore;
      if (item.subject === 'ÖZGÜNLÜK') val = student.evaluation.originalityScore;
      if (item.subject === 'YARATICILIK') val = student.evaluation.creativityScore;
      if (item.subject === 'DİL BİLGİSİ') val = Math.max(0, 100 - (student.evaluation.punctuationErrors.length * 5));
      if (item.subject === 'GENEL PUAN') val = student.evaluation.overallScore;
      newItem[student.name] = val;
    });
    return newItem;
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={finalData}>
        <PolarGrid stroke="#E2E8F0" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748B', fontSize: 10, fontWeight: 800 }} />
        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
        {selectedStudents.map((student, idx) => (
          <Radar
            key={student.id}
            name={student.name}
            dataKey={student.name}
            stroke={colors[idx % colors.length]}
            fill={colors[idx % colors.length]}
            fillOpacity={0.2}
            strokeWidth={3}
          />
        ))}
        <Legend verticalAlign="bottom" height={36}/>
        <Tooltip contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} />
      </RadarChart>
    </ResponsiveContainer>
  );
};

const EvaluationRadar: React.FC<{ evaluation: Evaluation }> = ({ evaluation }) => {
  const data = [
    { subject: 'YAZIM GÜZELLİĞİ', A: evaluation.handwritingScore },
    { subject: 'ÖZGÜNLÜK', A: evaluation.originalityScore },
    { subject: 'YARATICILIK', A: evaluation.creativityScore },
    { subject: 'DİL BİLGİSİ', A: Math.max(0, 100 - (evaluation.punctuationErrors.length * 5)) },
    { subject: 'GENEL PUAN', A: evaluation.overallScore },
  ];
  return (
    <div className="w-full h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
          <PolarGrid stroke="#E2E8F0" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748B', fontSize: 9, fontWeight: 800 }} />
          <Radar name="Skor" dataKey="A" stroke="#4F46E5" strokeWidth={3} fill="#4F46E5" fillOpacity={0.4} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};

const EvaluationDetail: React.FC<{
  student: Student;
  grade?: Grade;
  isSavedView?: boolean;
  onSave?: () => void;
}> = ({ student, grade, isSavedView, onSave }) => {
  if (!student.evaluation) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-[60px] shadow-2xl p-8 md:p-16 print-container relative overflow-hidden mt-8 animate-in slide-in-from-bottom duration-700">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-50/20 rounded-full -mr-64 -mt-64 blur-[100px] pointer-events-none"></div>
      <div className="flex flex-col lg:flex-row gap-16 relative z-10">
        <div className="w-full lg:w-1/3 space-y-10 no-print">
          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300 mb-6 flex items-center gap-3"><span className="w-3 h-3 bg-indigo-600 rounded-full"></span> ÖĞRENCİ ÇALIŞMASI</h4>
            <img src={student.workImage} alt="Öğrenci Yazısı" className="w-full rounded-[40px] border-4 border-slate-50 shadow-2xl transition-transform hover:scale-[1.02] duration-500" />
          </div>
          <div className="bg-slate-50/50 p-8 rounded-[44px] border border-slate-100">
             <h4 className="font-black text-slate-400 text-[9px] mb-8 uppercase tracking-[0.3em] text-center">Yetenek Analiz Grafiği</h4>
             <EvaluationRadar evaluation={student.evaluation} />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex flex-col sm:flex-row justify-between items-start mb-16 gap-8">
            <div className="space-y-3">
              <h3 className="text-5xl md:text-6xl font-[900] text-slate-900 leading-tight tracking-tighter">{student.name}</h3>
              <p className="text-indigo-600 font-[800] uppercase tracking-[0.3em] text-xs flex items-center gap-2">{grade?.name} Hikaye Analiz Raporu {isSavedView && <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-[9px] ml-2">Arşiv</span>}</p>
            </div>
            <div className="bg-indigo-600 text-white p-10 rounded-[48px] shadow-2xl flex flex-col items-center min-w-[160px]">
               <span className="text-[11px] uppercase font-black opacity-70 mb-2 tracking-[0.2em]">Genel Skor</span>
               <span className="text-7xl font-[900] leading-none">{student.evaluation.overallScore}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-16">
            <ScoreCard label="El Yazısı" score={student.evaluation.handwritingScore} color="indigo" />
            <ScoreCard label="Özgünlük" score={student.evaluation.originalityScore} color="emerald" />
            <ScoreCard label="Yaratıcılık" score={student.evaluation.creativityScore} color="amber" />
            <ScoreCard label="Dil Bilgisi" score={Math.max(0, 100 - (student.evaluation.punctuationErrors.length * 5))} color="rose" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
             <div className="space-y-12">
                <div><h4 className="font-black text-slate-800 text-[10px] uppercase tracking-[0.3em] mb-6 flex items-center gap-3"><span className="w-2.5 h-2.5 bg-indigo-500 rounded-full shadow-md"></span> Metin Dökümü</h4><p className="text-base text-slate-600 leading-relaxed bg-slate-50/80 p-10 rounded-[44px] border border-slate-100 italic shadow-inner">"{student.evaluation.transcribedText}"</p></div>
                <div><h4 className="font-black text-slate-800 text-[10px] mb-6 uppercase tracking-[0.3em] flex items-center gap-3"><span className="w-2.5 h-2.5 bg-rose-500 rounded-full shadow-md"></span> Hatalar</h4><ul className="space-y-4">{student.evaluation.punctuationErrors.map((err, i) => (<li key={i} className="text-sm text-rose-800 bg-rose-50/60 px-8 py-5 rounded-[24px] border border-rose-100 flex items-start gap-4"><span className="text-rose-400 font-black text-xl mt-1">•</span> {err}</li>))}{student.evaluation.punctuationErrors.length === 0 && <li className="text-emerald-700 font-black text-sm p-8 bg-emerald-50 rounded-[24px]">Harika! Hata yok.</li>}</ul></div>
             </div>
             <div className="space-y-12">
                <div className="bg-emerald-50/50 p-10 rounded-[50px] border border-emerald-100">
                   <h4 className="font-black text-emerald-900 text-[10px] mb-8 uppercase tracking-[0.3em]">Tavsiyeler</h4>
                   <div className="space-y-8">{student.evaluation.suggestions.map((s, i) => (<div key={i} className="border-l-[6px] border-emerald-200 pl-8 py-1"><p className="text-[11px] font-black text-emerald-900 uppercase mb-3">{s.topic}</p><p className="text-base text-emerald-800 leading-relaxed font-semibold">{s.action}</p></div>))}</div>
                </div>
                <div className="bg-amber-50/50 p-8 rounded-[36px] border border-amber-100 shadow-sm"><h4 className="font-black text-amber-800 text-[9px] mb-4 uppercase tracking-[0.2em]">Özgünlük Notu</h4><p className="text-sm text-amber-700 italic opacity-80">{student.evaluation.plagiarismNote}</p></div>
             </div>
          </div>
          <div className="mt-20 flex flex-col sm:flex-row items-center justify-end gap-6 no-print pt-12 border-t border-slate-100">
            {!isSavedView && <button onClick={onSave} className="w-full sm:w-auto bg-white border-2 border-slate-200 text-slate-700 px-10 py-5 rounded-[26px] font-black text-xs uppercase tracking-[0.15em] hover:bg-slate-50 active:scale-95 shadow-sm">Arşive Kaydet</button>}
            <PDFGenerator student={student} grade={grade} />
          </div>
        </div>
      </div>
    </div>
  );
};

const ScoreCard: React.FC<{ label: string; score: number; color: string }> = ({ label, score, color }) => {
  const colors: Record<string, string> = {
    indigo: 'text-indigo-600 bg-indigo-50 border-indigo-100',
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    amber: 'text-amber-600 bg-amber-50 border-amber-100',
    rose: 'text-rose-600 bg-rose-50 border-rose-100'
  };
  return (
    <div className={`p-7 rounded-[36px] border-2 shadow-sm flex flex-col items-center justify-center ${colors[color]}`}>
      <p className="text-[10px] uppercase font-black mb-3 opacity-70 tracking-widest text-center">{label}</p>
      <p className="text-4xl font-[900] tracking-tighter">{score}</p>
    </div>
  );
};

const EmptyState: React.FC<{ icon: string; title: string; description: string }> = ({ icon, title, description }) => (
  <div className="bg-white border-2 border-slate-100 rounded-[64px] h-[650px] flex flex-col items-center justify-center text-center p-16 shadow-inner animate-in fade-in duration-1000">
    <div className="w-40 h-40 bg-indigo-50 rounded-[48px] flex items-center justify-center mb-12 rotate-3 shadow-2xl shadow-indigo-50/50">
       <svg xmlns="http://www.w3.org/2000/svg" className="w-20 h-20 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
    </div>
    <h3 className="text-4xl font-black text-slate-800 mb-6 tracking-tight">{title}</h3>
    <p className="text-slate-500 max-w-sm leading-relaxed font-bold text-base opacity-60">{description}</p>
  </div>
);

export default App;
