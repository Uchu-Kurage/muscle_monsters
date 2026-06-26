import { useState, useEffect } from 'react';
import './index.css';

type MuscleType = 'chest' | 'back' | 'legs' | 'abs';

interface MuscleStats {
  level: number;
  exp: number;
}

type AppState = Record<MuscleType, MuscleStats>;

const INITIAL_STATE: AppState = {
  chest: { level: 1, exp: 0 },
  back: { level: 1, exp: 0 },
  legs: { level: 1, exp: 0 },
  abs: { level: 1, exp: 0 },
};

const MUSCLE_NAMES: Record<MuscleType, string> = {
  chest: '大胸筋モン',
  back: '広背筋モン',
  legs: '四頭筋モン',
  abs: '腹直筋モン'
};

const MUSCLE_IMAGES: Record<MuscleType, string> = {
  chest: '/assets/chest.png',
  back: '/assets/back.png',
  legs: '/assets/legs.png',
  abs: '/assets/abs.png'
};

function getRequiredExp(level: number) {
  // レベルが上がるごとに必要な経験値が増える
  return level * 100;
}

function App() {
  const [stats, setStats] = useState<AppState>(() => {
    const saved = localStorage.getItem('muscleStats');
    return saved ? JSON.parse(saved) : INITIAL_STATE;
  });

  const [selectedMuscle, setSelectedMuscle] = useState<MuscleType>('chest');
  const [weight, setWeight] = useState<number | ''>('');
  const [reps, setReps] = useState<number | ''>('');
  const [sets, setSets] = useState<number | ''>('');

  const [levelUpEffect, setLevelUpEffect] = useState<MuscleType | null>(null);

  useEffect(() => {
    localStorage.setItem('muscleStats', JSON.stringify(stats));
  }, [stats]);

  const handleRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (weight === '' || reps === '' || sets === '') return;

    // 自重の場合は0kg入力も許容し、1kg相当で計算するか、回数×セットで固定値にする
    const w = weight === 0 ? 1 : Number(weight);
    const volume = w * Number(reps) * Number(sets);
    const gainedExp = Math.max(1, Math.floor(volume / 10)); // 10ボリューム = 1EXP

    setStats(prev => {
      const current = prev[selectedMuscle];
      let newExp = current.exp + gainedExp;
      let newLevel = current.level;
      let didLevelUp = false;

      while (newExp >= getRequiredExp(newLevel)) {
        newExp -= getRequiredExp(newLevel);
        newLevel++;
        didLevelUp = true;
      }

      if (didLevelUp) {
        setLevelUpEffect(selectedMuscle);
        setTimeout(() => setLevelUpEffect(null), 1500);
      }

      return {
        ...prev,
        [selectedMuscle]: { level: newLevel, exp: newExp }
      };
    });

    setWeight('');
    setReps('');
    setSets('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', width: '100%' }}>
      <header style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '2.5rem', color: 'var(--text-accent)' }}>マッスルモンスターズ</h1>
        <p style={{ color: 'var(--text-secondary)' }}>筋トレを記録してモンスターを育てよう！</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
        {(Object.keys(stats) as MuscleType[]).map(muscle => {
          const mStats = stats[muscle];
          const reqExp = getRequiredExp(mStats.level);
          const progress = (mStats.exp / reqExp) * 100;
          const isLevelingUp = levelUpEffect === muscle;

          return (
            <div key={muscle} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <h3>{MUSCLE_NAMES[muscle]}</h3>
              <p style={{ color: 'var(--border-highlight)', margin: '0.5rem 0', fontSize: '1.2rem' }}>Lv.{mStats.level}</p>
              
              <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '1rem 0' }}>
                <img 
                  src={MUSCLE_IMAGES[muscle]} 
                  alt={muscle} 
                  className={`monster-image ${isLevelingUp ? 'level-up-effect' : ''}`}
                  style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                />
              </div>

              <div style={{ width: '100%', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span>EXP</span>
                  <span>{mStats.exp} / {reqExp}</span>
                </div>
                <div className="exp-bar-container">
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label>鍛えた筋肉</label>
            <select value={selectedMuscle} onChange={e => setSelectedMuscle(e.target.value as MuscleType)}>
              <option value="chest">大胸筋</option>
              <option value="back">広背筋</option>
              <option value="legs">大腿四頭筋</option>
              <option value="abs">腹直筋</option>
            </select>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100px' }}>
            <label>重量 (kg)</label>
            <input type="number" min="0" value={weight} onChange={e => setWeight(Number(e.target.value) || '')} placeholder="0" required />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100px' }}>
            <label>回数</label>
            <input type="number" min="1" value={reps} onChange={e => setReps(Number(e.target.value) || '')} required />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100px' }}>
            <label>セット数</label>
            <input type="number" min="1" value={sets} onChange={e => setSets(Number(e.target.value) || '')} required />
          </div>

          <button type="submit" style={{ height: '45px', marginLeft: '1rem' }}>記録する</button>
        </form>
      </div>
    </div>
  );
}

export default App;
