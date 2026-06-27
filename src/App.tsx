import { useState, useEffect } from 'react';
import './index.css';

type MuscleType = 
  | 'chest' | 'back' | 'shoulder' | 'arms' | 'glutes' | 'legs' | 'abs'
  | 'obliques' | 'iliopsoas' | 'transversus_abdominis'
  | 'trapezius' | 'erector_spinae' | 'hamstrings' | 'rhomboids' | 'gluteus_medius';

interface MuscleStats {
  level: number;
  exp: number;
  lastTrainedAt?: number;
}

type AppState = Record<MuscleType, MuscleStats>;

interface ExerciseDef {
  id: string;
  name: string;
  targetMuscle: MuscleType;
  isBodyweight?: boolean;
}

interface TrainingLog {
  id: string;
  timestamp: number;
  exerciseName: string;
  weight: number;
  reps: number;
  sets: number;
  isBodyweight: boolean;
  gainedExp: number;
}

type TabType = 'characters' | 'record' | 'logs';

const MUSCLE_GROUPS = [
  { id: 'chest', title: '🛡️ 胸部', muscles: ['chest'] as MuscleType[] },
  { id: 'back', title: '🦅 背部', muscles: ['back', 'trapezius', 'erector_spinae', 'rhomboids'] as MuscleType[] },
  { id: 'shoulder_arms', title: '💪 肩・腕', muscles: ['shoulder', 'arms'] as MuscleType[] },
  { id: 'abs_core', title: '🔥 腹・体幹', muscles: ['abs', 'obliques', 'iliopsoas', 'transversus_abdominis'] as MuscleType[] },
  { id: 'legs_glutes', title: '🦵 脚・お尻', muscles: ['legs', 'hamstrings', 'glutes', 'gluteus_medius'] as MuscleType[] },
];

const EXERCISES: ExerciseDef[] = [
  // 胸 (Chest)
  { id: 'bench_press', name: 'ベンチプレス', targetMuscle: 'chest' },
  { id: 'push_up', name: '腕立て伏せ', targetMuscle: 'chest', isBodyweight: true },
  { id: 'dumbbell_fly', name: 'ダンベルフライ', targetMuscle: 'chest' },
  { id: 'chest_press', name: 'チェストプレス', targetMuscle: 'chest' },
  
  // 背中 (Back)
  { id: 'pull_up', name: '懸垂（チンニング）', targetMuscle: 'back', isBodyweight: true },
  { id: 'deadlift', name: 'デッドリフト', targetMuscle: 'back' },
  { id: 'lat_pulldown', name: 'ラットプルダウン', targetMuscle: 'back' },
  { id: 'bent_over_row', name: 'ベントオーバーロウ', targetMuscle: 'back' },
  
  // 僧帽筋 (Trapezius)
  { id: 'shrug', name: 'シュラッグ', targetMuscle: 'trapezius' },
  { id: 'upright_row', name: 'アップライトロウ', targetMuscle: 'trapezius' },
  
  // 菱形筋 (Rhomboids)
  { id: 'seated_row', name: 'シーテッドロウ', targetMuscle: 'rhomboids' },
  { id: 'one_hand_row', name: 'ワンハンドロウ', targetMuscle: 'rhomboids' },
  
  // 脊柱起立筋 (Erector Spinae)
  { id: 'back_extension', name: 'バックエクステンション', targetMuscle: 'erector_spinae', isBodyweight: true },
  { id: 'good_morning', name: 'グッドモーニング', targetMuscle: 'erector_spinae' },
  
  // 肩 (Shoulder)
  { id: 'back_press', name: 'バックプレス', targetMuscle: 'shoulder' },
  { id: 'shoulder_press', name: 'ショルダープレス', targetMuscle: 'shoulder' },
  { id: 'side_raise', name: 'サイドレイズ', targetMuscle: 'shoulder' },
  { id: 'front_raise', name: 'フロントレイズ', targetMuscle: 'shoulder' },
  
  // 腕 (Arms)
  { id: 'arm_curl', name: 'アームカール', targetMuscle: 'arms' },
  { id: 'french_press', name: 'フレンチプレス', targetMuscle: 'arms' },
  { id: 'kick_back', name: 'キックバック', targetMuscle: 'arms' },
  { id: 'dips', name: 'ディップス', targetMuscle: 'arms', isBodyweight: true },
  
  // お尻 (Glutes)
  { id: 'hip_thrust', name: 'ヒップスラスト', targetMuscle: 'glutes' },
  { id: 'back_kick', name: 'バックキック', targetMuscle: 'glutes', isBodyweight: true },
  { id: 'bulgarian_squat', name: 'ブルガリアンスクワット', targetMuscle: 'glutes', isBodyweight: true },
  
  // 中殿筋 (Gluteus Medius)
  { id: 'abduction', name: 'アブダクション', targetMuscle: 'gluteus_medius' },
  { id: 'clamshell', name: 'クラムシェル', targetMuscle: 'gluteus_medius', isBodyweight: true },
  
  // 脚 (Legs)
  { id: 'squat', name: 'スクワット', targetMuscle: 'legs', isBodyweight: true },
  { id: 'leg_press', name: 'レッグプレス', targetMuscle: 'legs' },
  { id: 'leg_extension', name: 'レッグエクステンション', targetMuscle: 'legs' },
  { id: 'lunge', name: 'ランジ', targetMuscle: 'legs', isBodyweight: true },
  
  // ハムストリングス (Hamstrings)
  { id: 'leg_curl', name: 'レッグカール', targetMuscle: 'hamstrings' },
  { id: 'romanian_deadlift', name: 'ルーマニアンデッドリフト', targetMuscle: 'hamstrings' },
  
  // 腹直筋 (Abs)
  { id: 'crunch', name: 'クランチ', targetMuscle: 'abs', isBodyweight: true },
  { id: 'ab_roller', name: '腹筋ローラー (アブローラー)', targetMuscle: 'abs', isBodyweight: true },
  
  // 腹斜筋 (Obliques)
  { id: 'side_crunch', name: 'サイドクランチ', targetMuscle: 'obliques', isBodyweight: true },
  { id: 'russian_twist', name: 'ロシアンツイスト', targetMuscle: 'obliques', isBodyweight: true },
  
  // 腸腰筋 (Iliopsoas)
  { id: 'bicycle_crunch', name: 'バイシクルクランチ', targetMuscle: 'iliopsoas', isBodyweight: true },
  { id: 'leg_raise', name: 'レッグレイズ', targetMuscle: 'iliopsoas', isBodyweight: true },
  
  // 腹横筋 (Transversus Abdominis)
  { id: 'draw_in', name: 'ドローイン (自重設定)', targetMuscle: 'transversus_abdominis', isBodyweight: true },
  { id: 'plank', name: 'プランク (自重設定)', targetMuscle: 'transversus_abdominis', isBodyweight: true },
];

const INITIAL_STATE: AppState = {
  chest: { level: 1, exp: 0 },
  back: { level: 1, exp: 0 },
  shoulder: { level: 1, exp: 0 },
  arms: { level: 1, exp: 0 },
  glutes: { level: 1, exp: 0 },
  legs: { level: 1, exp: 0 },
  abs: { level: 1, exp: 0 },
  obliques: { level: 1, exp: 0 },
  iliopsoas: { level: 1, exp: 0 },
  transversus_abdominis: { level: 1, exp: 0 },
  trapezius: { level: 1, exp: 0 },
  erector_spinae: { level: 1, exp: 0 },
  hamstrings: { level: 1, exp: 0 },
  rhomboids: { level: 1, exp: 0 },
  gluteus_medius: { level: 1, exp: 0 },
};

const MUSCLE_NAMES: Record<MuscleType, string> = {
  chest: '大胸筋',
  back: '広背筋',
  shoulder: '三角筋',
  arms: '上腕筋',
  glutes: '大臀筋',
  legs: '大腿四頭筋',
  abs: '腹直筋',
  obliques: '腹斜筋',
  iliopsoas: '腸腰筋',
  transversus_abdominis: '腹横筋',
  trapezius: '僧帽筋',
  erector_spinae: '脊柱起立筋',
  hamstrings: 'ハムストリングス',
  rhomboids: '菱形筋',
  gluteus_medius: '中殿筋',
};

const DETRAIN_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14日間

function getRequiredExp(level: number) {
  return level * 100;
}

function getEvolutionPhase(level: number): 1 | 2 | 3 {
  if (level < 5) return 1;
  if (level < 10) return 2;
  return 3;
}

function formatDate(ms: number): string {
  const date = new Date(ms);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  return `${m}/${d} ${hh}:${mm}`;
}

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('characters');

  const [stats, setStats] = useState<AppState>(() => {
    const saved = localStorage.getItem('muscleStats');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...INITIAL_STATE, ...parsed };
    }
    return INITIAL_STATE;
  });

  const [bodyWeight, setBodyWeight] = useState<number>(() => {
    const saved = localStorage.getItem('userBodyWeight');
    return saved ? Number(saved) : 60;
  });

  const [trainingLogs, setTrainingLogs] = useState<TrainingLog[]>(() => {
    const saved = localStorage.getItem('trainingLogs');
    return saved ? JSON.parse(saved) : [];
  });

  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(EXERCISES[0].id);
  const [weight, setWeight] = useState<number | ''>('');
  const [reps, setReps] = useState<number | ''>('');
  const [sets, setSets] = useState<number | ''>('');

  const [levelUpEffect, setLevelUpEffect] = useState<MuscleType | null>(null);
  const [evolutionAlert, setEvolutionAlert] = useState<{ muscle: MuscleType, phase: number } | null>(null);
  const [bestPumpAlert, setBestPumpAlert] = useState<MuscleType | null>(null);
  const [detrainAlert, setDetrainAlert] = useState<string[]>([]);
  const [recordSuccess, setRecordSuccess] = useState(false);

  useEffect(() => {
    const now = Date.now();
    let hasChanges = false;
    const newStats = { ...stats };
    const droppedMuscles: string[] = [];

    (Object.keys(newStats) as MuscleType[]).map(muscle => {
      const mStat = newStats[muscle];
      if (mStat.lastTrainedAt && (now - mStat.lastTrainedAt > DETRAIN_THRESHOLD_MS)) {
        if (mStat.exp > 0) {
          mStat.exp = Math.floor(mStat.exp / 2);
          hasChanges = true;
          droppedMuscles.push(MUSCLE_NAMES[muscle]);
        }
        mStat.lastTrainedAt = now;
      }
    });

    if (hasChanges) {
      setStats(newStats);
      setDetrainAlert(droppedMuscles);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('muscleStats', JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    localStorage.setItem('userBodyWeight', bodyWeight.toString());
  }, [bodyWeight]);

  useEffect(() => {
    localStorage.setItem('trainingLogs', JSON.stringify(trainingLogs));
  }, [trainingLogs]);

  const selectedExercise = EXERCISES.find(ex => ex.id === selectedExerciseId);
  const isBodyweight = selectedExercise?.isBodyweight || false;

  const handleRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExercise) return;
    
    // 自重の場合は体重、そうでなければ入力された重量（空なら1）
    const w = isBodyweight ? bodyWeight : (weight === '' || weight === 0 ? 1 : Number(weight));
    const r = Number(reps);
    const s = Number(sets);
    
    if (r === 0 || s === 0) return;

    const volume = w * r * s;
    const targetMuscle = selectedExercise.targetMuscle;
    let gainedExp = Math.max(1, Math.floor(volume / 10));

    const isBestPump = (r >= 8 && r <= 12 && s >= 3 && s <= 5);
    if (isBestPump) {
      gainedExp = Math.floor(gainedExp * 1.5);
      setBestPumpAlert(targetMuscle);
      setTimeout(() => setBestPumpAlert(null), 2500);
    }

    setStats(prev => {
      const current = prev[targetMuscle];
      let newExp = current.exp + gainedExp;
      let newLevel = current.level;
      let didLevelUp = false;

      while (newExp >= getRequiredExp(newLevel)) {
        newExp -= getRequiredExp(newLevel);
        newLevel++;
        didLevelUp = true;
      }

      if (didLevelUp) {
        const oldPhase = getEvolutionPhase(current.level);
        const newPhase = getEvolutionPhase(newLevel);

        if (newPhase > oldPhase) {
          setEvolutionAlert({ muscle: targetMuscle, phase: newPhase });
        } else {
          setLevelUpEffect(targetMuscle);
          setTimeout(() => setLevelUpEffect(null), 1500);
        }
      }

      return {
        ...prev,
        [targetMuscle]: { 
          level: newLevel, 
          exp: newExp, 
          lastTrainedAt: Date.now() 
        }
      };
    });

    const newLog: TrainingLog = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      exerciseName: selectedExercise.name,
      weight: w,
      reps: r,
      sets: s,
      isBodyweight: isBodyweight,
      gainedExp: gainedExp
    };

    setTrainingLogs(prev => [newLog, ...prev]);

    if (!isBodyweight) {
      setWeight('');
    }
    setReps('');
    setSets('');

    setRecordSuccess(true);
    setTimeout(() => setRecordSuccess(false), 2000);
  };

  const closeEvolutionAlert = () => {
    setEvolutionAlert(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', paddingBottom: '2rem' }}>
      <header style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
        <h1 style={{ fontSize: '2.5rem', color: 'var(--text-accent)', marginBottom: '0.5rem' }}>マッスルモンスターズ</h1>
        <p style={{ color: 'var(--text-secondary)' }}>筋トレを記録して筋肉を育てよう！</p>
      </header>

      {/* タブナビゲーション */}
      <div className="tab-container">
        <button 
          className={`tab-button ${activeTab === 'characters' ? 'active' : ''}`} 
          onClick={() => setActiveTab('characters')}
        >
          👾 キャラクター
        </button>
        <button 
          className={`tab-button ${activeTab === 'record' ? 'active' : ''}`} 
          onClick={() => setActiveTab('record')}
        >
          🏋️ 筋トレ記録
        </button>
        <button 
          className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`} 
          onClick={() => setActiveTab('logs')}
        >
          📖 ログ
        </button>
      </div>

      {detrainAlert.length > 0 && (
        <div className="glass-panel" style={{ borderColor: 'red', backgroundColor: 'rgba(255, 0, 0, 0.1)', textAlign: 'center', marginBottom: '1rem' }}>
          <h3 style={{ color: '#ff4444' }}>⚠️ 筋肉ダウンのお知らせ</h3>
          <p>14日間以上トレーニングをサボったため、以下の筋肉が落ちて（EXP半減）しまいました…</p>
          <p style={{ fontWeight: 'bold', margin: '0.5rem 0' }}>{detrainAlert.join('、')}</p>
          <button onClick={() => setDetrainAlert([])} style={{ borderColor: 'red', color: 'red', marginTop: '1rem' }}>確認した</button>
        </div>
      )}

      {/* --- タブコンテンツ：キャラクター --- */}
      {activeTab === 'characters' && (
        <div>
          {MUSCLE_GROUPS.map(group => (
            <div key={group.id} style={{ marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
                {group.title}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '1rem' }}>
                {group.muscles.map(muscle => {
                  const mStats = stats[muscle];
                  const reqExp = getRequiredExp(mStats.level);
                  const progress = (mStats.exp / reqExp) * 100;
                  const isLevelingUp = levelUpEffect === muscle;
                  const isBestPump = bestPumpAlert === muscle;
                  const phase = getEvolutionPhase(mStats.level);

                  return (
                    <div key={muscle} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', padding: '0.8rem 0.5rem' }}>
                      
                      {isBestPump && (
                        <div className="best-pump-badge" style={{ fontSize: '0.8rem', padding: '2px 6px', top: '2px' }}>
                          PUMP!<br/>x1.5
                        </div>
                      )}

                      <h3 style={{ fontSize: '0.9rem', marginBottom: '0.2rem' }}>{MUSCLE_NAMES[muscle]}</h3>
                      <p style={{ color: 'var(--border-highlight)', margin: '0', fontSize: '0.8rem' }}>Lv.{mStats.level}</p>
                      
                      <div style={{ height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0.5rem 0' }}>
                        <img 
                          src={`/assets/${muscle}_${phase}.png`} 
                          alt={muscle} 
                          className={`monster-image ${isLevelingUp ? 'level-up-effect' : ''}`}
                          style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                        />
                      </div>

                      <div style={{ width: '100%', fontSize: '0.7rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                          <span>EXP</span>
                          <span>{mStats.exp}/{reqExp}</span>
                        </div>
                        <div className="exp-bar-container" style={{ height: '6px' }}>
                          <div className="exp-bar-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- タブコンテンツ：筋トレ記録 --- */}
      {activeTab === 'record' && (
        <div className="glass-panel" style={{ marginTop: '0', position: 'relative' }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>🏋️ 筋トレを記録する</h2>
          
          {/* 体重設定セクション */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>体重設定 (自重用):</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input 
                type="number" 
                min="1" 
                value={bodyWeight} 
                onChange={e => setBodyWeight(Number(e.target.value) || 60)} 
                style={{ width: '70px', padding: '5px' }}
              />
              <span>kg</span>
            </div>
          </div>

          <form onSubmit={handleRecord} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', alignItems: 'flex-end' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', maxWidth: '300px' }}>
              <label>トレーニング種目</label>
              <select value={selectedExerciseId} onChange={e => setSelectedExerciseId(e.target.value)}>
                {EXERCISES.map(ex => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '85px' }}>
                <label style={{ fontSize: '0.8rem' }}>重量 (kg)</label>
                {isBodyweight ? (
                  <input type="text" value={`自重(${bodyWeight})`} disabled style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.8rem', padding: '0' }} />
                ) : (
                  <input type="number" min="0" value={weight} onChange={e => setWeight(Number(e.target.value) || '')} placeholder="0" required />
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '85px' }}>
                <label style={{ fontSize: '0.8rem' }}>回数/秒数</label>
                <input type="number" min="1" value={reps} onChange={e => setReps(Number(e.target.value) || '')} required />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '85px' }}>
                <label style={{ fontSize: '0.8rem' }}>セット数</label>
                <input type="number" min="1" value={sets} onChange={e => setSets(Number(e.target.value) || '')} required />
              </div>
            </div>

            <button type="submit" style={{ height: '45px', width: '100%', maxWidth: '300px', marginTop: '1rem' }}>記録する</button>
          </form>
          
          {recordSuccess && (
            <div style={{ textAlign: 'center', color: '#39ff14', fontWeight: 'bold', marginTop: '1rem', animation: 'scaleIn 0.3s ease-out' }}>
              記録しました！EXP獲得！
            </div>
          )}

          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '1.5rem' }}>
            ※ 8〜12回、3〜5セットで記録すると「PUMP!」ボーナス！
          </p>
        </div>
      )}

      {/* --- タブコンテンツ：ログ --- */}
      {activeTab === 'logs' && (
        <div className="glass-panel" style={{ marginTop: '0' }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>📖 トレーニング履歴</h2>
          {trainingLogs.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>まだ記録がありません。トレーニングを開始しましょう！</p>
          ) : (
            <div style={{ maxHeight: '600px', overflowY: 'auto', paddingRight: '10px' }}>
              {trainingLogs.map(log => (
                <div key={log.id} style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '1rem', 
                  borderRadius: '8px', 
                  marginBottom: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.5rem'
                }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      {formatDate(log.timestamp)}
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-accent)' }}>
                      {log.exerciseName}
                    </div>
                    <div style={{ fontSize: '0.95rem', marginTop: '4px' }}>
                      {log.isBodyweight ? `自重(${log.weight}kg)` : `${log.weight}kg`} × {log.reps}回 × {log.sets}セット
                    </div>
                  </div>
                  <div style={{ 
                    background: 'rgba(57, 255, 20, 0.1)', 
                    color: 'var(--text-accent)', 
                    padding: '8px 12px', 
                    borderRadius: '16px',
                    fontWeight: 'bold',
                    fontSize: '0.9rem'
                  }}>
                    +{log.gainedExp} EXP
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Evolution Modal Overlay */}
      {evolutionAlert && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ textAlign: 'center', animation: 'scaleIn 0.5s ease-out' }}>
            <h1 style={{ color: '#ffea00', fontSize: '3rem', marginBottom: '1rem' }}>進化！！</h1>
            <p style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>
              おめでとう！<br/>{MUSCLE_NAMES[evolutionAlert.muscle]} は 第{evolutionAlert.phase}形態 に進化した！
            </p>
            <img 
              src={`/assets/${evolutionAlert.muscle}_${evolutionAlert.phase}.png`} 
              alt="Evolved Muscle" 
              className="monster-image"
              style={{ maxHeight: '250px', maxWidth: '100%', objectFit: 'contain', marginBottom: '2rem' }}
            />
            <br />
            <button onClick={closeEvolutionAlert} style={{ width: '100%', maxWidth: '200px' }}>閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
