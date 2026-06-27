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
}

const EXERCISES: ExerciseDef[] = [
  // 胸 (Chest)
  { id: 'bench_press', name: 'ベンチプレス', targetMuscle: 'chest' },
  { id: 'push_up', name: '腕立て伏せ', targetMuscle: 'chest' },
  { id: 'dumbbell_fly', name: 'ダンベルフライ', targetMuscle: 'chest' },
  { id: 'chest_press', name: 'チェストプレス', targetMuscle: 'chest' },
  
  // 背中 (Back)
  { id: 'pull_up', name: '懸垂（チンニング）', targetMuscle: 'back' },
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
  { id: 'back_extension', name: 'バックエクステンション', targetMuscle: 'erector_spinae' },
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
  { id: 'dips', name: 'ディップス', targetMuscle: 'arms' },
  
  // お尻 (Glutes)
  { id: 'hip_thrust', name: 'ヒップスラスト', targetMuscle: 'glutes' },
  { id: 'back_kick', name: 'バックキック', targetMuscle: 'glutes' },
  { id: 'bulgarian_squat', name: 'ブルガリアンスクワット', targetMuscle: 'glutes' },
  
  // 中殿筋 (Gluteus Medius)
  { id: 'abduction', name: 'アブダクション', targetMuscle: 'gluteus_medius' },
  { id: 'clamshell', name: 'クラムシェル', targetMuscle: 'gluteus_medius' },
  
  // 脚 (Legs)
  { id: 'squat', name: 'スクワット', targetMuscle: 'legs' },
  { id: 'leg_press', name: 'レッグプレス', targetMuscle: 'legs' },
  { id: 'leg_extension', name: 'レッグエクステンション', targetMuscle: 'legs' },
  { id: 'lunge', name: 'ランジ', targetMuscle: 'legs' },
  
  // ハムストリングス (Hamstrings)
  { id: 'leg_curl', name: 'レッグカール', targetMuscle: 'hamstrings' },
  { id: 'romanian_deadlift', name: 'ルーマニアンデッドリフト', targetMuscle: 'hamstrings' },
  
  // 腹直筋 (Abs)
  { id: 'crunch', name: 'クランチ', targetMuscle: 'abs' },
  { id: 'ab_roller', name: 'アブローラー', targetMuscle: 'abs' },
  
  // 腹斜筋 (Obliques)
  { id: 'side_crunch', name: 'サイドクランチ', targetMuscle: 'obliques' },
  { id: 'russian_twist', name: 'ロシアンツイスト', targetMuscle: 'obliques' },
  
  // 腸腰筋 (Iliopsoas)
  { id: 'bicycle_crunch', name: 'バイシクルクランチ', targetMuscle: 'iliopsoas' },
  { id: 'leg_raise', name: 'レッグレイズ', targetMuscle: 'iliopsoas' },
  
  // 腹横筋 (Transversus Abdominis)
  { id: 'draw_in', name: 'ドローイン (重量1kg/回数=秒数)', targetMuscle: 'transversus_abdominis' },
  { id: 'plank', name: 'プランク (重量1kg/回数=秒数)', targetMuscle: 'transversus_abdominis' },
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

function App() {
  const [stats, setStats] = useState<AppState>(() => {
    const saved = localStorage.getItem('muscleStats');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Ensure new muscles exist in old save data
      return { ...INITIAL_STATE, ...parsed };
    }
    return INITIAL_STATE;
  });

  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(EXERCISES[0].id);
  const [weight, setWeight] = useState<number | ''>('');
  const [reps, setReps] = useState<number | ''>('');
  const [sets, setSets] = useState<number | ''>('');

  const [levelUpEffect, setLevelUpEffect] = useState<MuscleType | null>(null);
  const [evolutionAlert, setEvolutionAlert] = useState<{ muscle: MuscleType, phase: number } | null>(null);
  const [bestPumpAlert, setBestPumpAlert] = useState<MuscleType | null>(null);
  const [detrainAlert, setDetrainAlert] = useState<string[]>([]);

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

  const handleRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (weight === '' || reps === '' || sets === '') return;

    const selectedExercise = EXERCISES.find(ex => ex.id === selectedExerciseId);
    if (!selectedExercise) return;

    const targetMuscle = selectedExercise.targetMuscle;
    const w = weight === 0 ? 1 : Number(weight);
    const r = Number(reps);
    const s = Number(sets);
    const volume = w * r * s;
    
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

    setWeight('');
    setReps('');
    setSets('');
  };

  const closeEvolutionAlert = () => {
    setEvolutionAlert(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', width: '100%', paddingBottom: '2rem' }}>
      <header style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '2.5rem', color: 'var(--text-accent)' }}>マッスルモンスターズ</h1>
        <p style={{ color: 'var(--text-secondary)' }}>筋トレを記録して筋肉を育てよう！</p>
      </header>

      {detrainAlert.length > 0 && (
        <div className="glass-panel" style={{ borderColor: 'red', backgroundColor: 'rgba(255, 0, 0, 0.1)', textAlign: 'center' }}>
          <h3 style={{ color: '#ff4444' }}>⚠️ 筋肉ダウンのお知らせ</h3>
          <p>14日間以上トレーニングをサボったため、以下の筋肉が落ちて（EXP半減）しまいました…</p>
          <p style={{ fontWeight: 'bold', margin: '0.5rem 0' }}>{detrainAlert.join('、')}</p>
          <button onClick={() => setDetrainAlert([])} style={{ borderColor: 'red', color: 'red', marginTop: '1rem' }}>確認した</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.5rem' }}>
        {(Object.keys(stats) as MuscleType[]).map(muscle => {
          const mStats = stats[muscle];
          const reqExp = getRequiredExp(mStats.level);
          const progress = (mStats.exp / reqExp) * 100;
          const isLevelingUp = levelUpEffect === muscle;
          const isBestPump = bestPumpAlert === muscle;
          const phase = getEvolutionPhase(mStats.level);

          return (
            <div key={muscle} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', padding: '1rem' }}>
              
              {isBestPump && (
                <div className="best-pump-badge" style={{ fontSize: '1rem', padding: '2px 10px', top: '5px' }}>
                  BEST PUMP!!<br/><small>EXP x1.5</small>
                </div>
              )}

              <h3 style={{ fontSize: '1rem' }}>{MUSCLE_NAMES[muscle]}</h3>
              <p style={{ color: 'var(--border-highlight)', margin: '0.2rem 0', fontSize: '0.9rem' }}>Lv.{mStats.level}</p>
              
              <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0.5rem 0' }}>
                <img 
                  src={`/assets/${muscle}_${phase}.png`} 
                  alt={muscle} 
                  className={`monster-image ${isLevelingUp ? 'level-up-effect' : ''}`}
                  style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                />
              </div>

              <div style={{ width: '100%', fontSize: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span>EXP</span>
                  <span>{mStats.exp} / {reqExp}</span>
                </div>
                <div className="exp-bar-container" style={{ height: '8px' }}>
                  <div className="exp-bar-fill" style={{ width: `${progress}%` }}></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass-panel" style={{ marginTop: '2rem' }}>
        <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>🏋️ 筋トレ記録</h2>
        <form onSubmit={handleRecord} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', alignItems: 'flex-end' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '220px' }}>
            <label>トレーニング種目</label>
            <select value={selectedExerciseId} onChange={e => setSelectedExerciseId(e.target.value)}>
              {EXERCISES.map(ex => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100px' }}>
            <label>重量 (kg)</label>
            <input type="number" min="0" value={weight} onChange={e => setWeight(Number(e.target.value) || '')} placeholder="0" required />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100px' }}>
            <label>回数/秒数</label>
            <input type="number" min="1" value={reps} onChange={e => setReps(Number(e.target.value) || '')} required />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100px' }}>
            <label>セット数</label>
            <input type="number" min="1" value={sets} onChange={e => setSets(Number(e.target.value) || '')} required />
          </div>

          <button type="submit" style={{ height: '45px', marginLeft: '1rem' }}>記録する</button>
        </form>
        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '1rem' }}>
          ※ 8〜12回、3〜5セットで記録すると「ベスト・パンプ！」が発生しEXPボーナス！
        </p>
      </div>

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
