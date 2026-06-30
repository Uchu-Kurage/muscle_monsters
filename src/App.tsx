import { useState, useEffect } from 'react';
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import './index.css';

type MuscleType = 
  | 'chest' | 'back' | 'shoulder' | 'arms' | 'glutes' | 'legs' | 'abs'
  | 'obliques' | 'iliopsoas' | 'transversus_abdominis'
  | 'trapezius' | 'erector_spinae' | 'hamstrings' | 'rhomboids' | 'gluteus_medius';

interface MuscleStats {
  level: number;
  exp: number;
  lastTrainedAt?: number;
  hasProteinBonus?: boolean;
}

type AppState = Record<MuscleType, MuscleStats>;

interface ExerciseDef {
  id: string;
  name: string;
  primaryMuscle: MuscleType;
  targets: { muscle: MuscleType; expRatio: number }[];
  isBodyweight?: boolean;
}

interface RecordResultDetail {
  muscle: MuscleType;
  oldExp: number;
  oldLevel: number;
  newExp: number;
  newLevel: number;
  gainedExp: number;
  isOverworked: boolean;
  isProteinBonus: boolean;
  evolutionPhase?: number;
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

type TabType = 'characters' | 'record' | 'logs' | 'achievements';

interface Achievement {
  id: string;
  name: string;
  description: string;
  check: (stats: Record<MuscleType, MuscleStats>, logs: TrainingLog[]) => boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_blood', name: '駆け出しトレーニー', description: '初めてトレーニングを記録する', check: (_, logs) => logs.length > 0 },
  { id: 'habit_3', name: '習慣化への第一歩', description: 'トレーニングを累計3日記録する', check: (_, logs) => new Set(logs.map(l => new Date(l.timestamp).toDateString())).size >= 3 },
  { id: 'habit_7', name: '鉄の意志', description: 'トレーニングを累計7日記録する', check: (_, logs) => new Set(logs.map(l => new Date(l.timestamp).toDateString())).size >= 7 },
  { id: 'chest_master', name: '大胸筋マスター', description: '大胸筋のレベルを10にする', check: (stats) => stats.chest.level >= 10 },
  { id: 'back_master', name: '広背筋マスター', description: '広背筋のレベルを10にする', check: (stats) => stats.back.level >= 10 },
  { id: 'legs_master', name: '大腿四頭筋マスター', description: '大腿四頭筋のレベルを10にする', check: (stats) => stats.legs.level >= 10 },
  { id: 'squat_lover', name: 'スクワット狂', description: 'スクワットを累計10回記録する', check: (_, logs) => logs.filter(l => l.exerciseName.includes('スクワット')).length >= 10 },
  { id: 'full_body', name: '全身筋肉痛', description: '1日で3種類以上の種目をトレーニングする', check: (_, logs) => {
      const today = new Date().toDateString();
      const todayLogs = logs.filter(l => new Date(l.timestamp).toDateString() === today);
      return new Set(todayLogs.map(l => l.exerciseName)).size >= 3;
  }},
  { id: 'limit_break', name: '限界突破', description: '1回のトレーニングで100EXP以上獲得する', check: (_, logs) => logs.some(l => l.gainedExp >= 100) },
];

const MUSCLE_GROUPS = [
  { id: 'chest', title: '🛡️ 胸部', muscles: ['chest'] as MuscleType[] },
  { id: 'back', title: '🦅 背部', muscles: ['back', 'trapezius', 'erector_spinae', 'rhomboids'] as MuscleType[] },
  { id: 'shoulder_arms', title: '💪 肩・腕', muscles: ['shoulder', 'arms'] as MuscleType[] },
  { id: 'abs_core', title: '🔥 腹・体幹', muscles: ['abs', 'obliques', 'iliopsoas', 'transversus_abdominis'] as MuscleType[] },
  { id: 'legs_glutes', title: '🦵 脚・お尻', muscles: ['legs', 'hamstrings', 'glutes', 'gluteus_medius'] as MuscleType[] },
];

const EXERCISES: ExerciseDef[] = [
  // 胸 (Chest)
  { id: 'bench_press', name: 'ベンチプレス', primaryMuscle: 'chest', targets: [{muscle: 'chest', expRatio: 1.0}, {muscle: 'arms', expRatio: 0.5}, {muscle: 'shoulder', expRatio: 0.4}] },
  { id: 'push_up', name: '腕立て伏せ', primaryMuscle: 'chest', isBodyweight: true, targets: [{muscle: 'chest', expRatio: 1.0}, {muscle: 'arms', expRatio: 0.5}, {muscle: 'abs', expRatio: 0.2}] },
  { id: 'dumbbell_fly', name: 'ダンベルフライ', primaryMuscle: 'chest', targets: [{muscle: 'chest', expRatio: 1.0}, {muscle: 'shoulder', expRatio: 0.2}] },
  { id: 'chest_press', name: 'チェストプレス', primaryMuscle: 'chest', targets: [{muscle: 'chest', expRatio: 1.0}, {muscle: 'arms', expRatio: 0.4}] },
  
  // 背中 (Back)
  { id: 'pull_up', name: '懸垂（チンニング）', primaryMuscle: 'back', isBodyweight: true, targets: [{muscle: 'back', expRatio: 1.0}, {muscle: 'arms', expRatio: 0.6}, {muscle: 'rhomboids', expRatio: 0.4}] },
  { id: 'deadlift', name: 'デッドリフト', primaryMuscle: 'back', targets: [{muscle: 'erector_spinae', expRatio: 1.0}, {muscle: 'back', expRatio: 0.8}, {muscle: 'glutes', expRatio: 0.6}, {muscle: 'hamstrings', expRatio: 0.5}] },
  { id: 'lat_pulldown', name: 'ラットプルダウン', primaryMuscle: 'back', targets: [{muscle: 'back', expRatio: 1.0}, {muscle: 'arms', expRatio: 0.4}, {muscle: 'rhomboids', expRatio: 0.3}] },
  { id: 'bent_over_row', name: 'ベントオーバーロウ', primaryMuscle: 'back', targets: [{muscle: 'back', expRatio: 1.0}, {muscle: 'rhomboids', expRatio: 0.8}, {muscle: 'erector_spinae', expRatio: 0.5}] },
  
  // 僧帽筋 (Trapezius)
  { id: 'shrug', name: 'シュラッグ', primaryMuscle: 'trapezius', targets: [{muscle: 'trapezius', expRatio: 1.0}] },
  { id: 'upright_row', name: 'アップライトロウ', primaryMuscle: 'trapezius', targets: [{muscle: 'trapezius', expRatio: 1.0}, {muscle: 'shoulder', expRatio: 0.6}] },
  
  // 菱形筋 (Rhomboids)
  { id: 'seated_row', name: 'シーテッドロウ', primaryMuscle: 'rhomboids', targets: [{muscle: 'rhomboids', expRatio: 1.0}, {muscle: 'back', expRatio: 0.6}, {muscle: 'arms', expRatio: 0.4}] },
  { id: 'one_hand_row', name: 'ワンハンドロウ', primaryMuscle: 'rhomboids', targets: [{muscle: 'rhomboids', expRatio: 1.0}, {muscle: 'back', expRatio: 0.8}, {muscle: 'arms', expRatio: 0.4}] },
  
  // 脊柱起立筋 (Erector Spinae)
  { id: 'back_extension', name: 'バックエクステンション', primaryMuscle: 'erector_spinae', isBodyweight: true, targets: [{muscle: 'erector_spinae', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.5}, {muscle: 'hamstrings', expRatio: 0.4}] },
  { id: 'good_morning', name: 'グッドモーニング', primaryMuscle: 'erector_spinae', targets: [{muscle: 'erector_spinae', expRatio: 1.0}, {muscle: 'hamstrings', expRatio: 0.8}, {muscle: 'glutes', expRatio: 0.6}] },
  
  // 肩 (Shoulder)
  { id: 'back_press', name: 'バックプレス', primaryMuscle: 'shoulder', targets: [{muscle: 'shoulder', expRatio: 1.0}, {muscle: 'arms', expRatio: 0.4}, {muscle: 'trapezius', expRatio: 0.3}] },
  { id: 'shoulder_press', name: 'ショルダープレス', primaryMuscle: 'shoulder', targets: [{muscle: 'shoulder', expRatio: 1.0}, {muscle: 'arms', expRatio: 0.5}, {muscle: 'chest', expRatio: 0.2}] },
  { id: 'side_raise', name: 'サイドレイズ', primaryMuscle: 'shoulder', targets: [{muscle: 'shoulder', expRatio: 1.0}] },
  { id: 'front_raise', name: 'フロントレイズ', primaryMuscle: 'shoulder', targets: [{muscle: 'shoulder', expRatio: 1.0}, {muscle: 'chest', expRatio: 0.2}] },
  
  // 腕 (Arms)
  { id: 'arm_curl', name: 'アームカール', primaryMuscle: 'arms', targets: [{muscle: 'arms', expRatio: 1.0}] },
  { id: 'french_press', name: 'フレンチプレス', primaryMuscle: 'arms', targets: [{muscle: 'arms', expRatio: 1.0}] },
  { id: 'kick_back', name: 'キックバック', primaryMuscle: 'arms', targets: [{muscle: 'arms', expRatio: 1.0}] },
  { id: 'dips', name: 'ディップス', primaryMuscle: 'arms', isBodyweight: true, targets: [{muscle: 'arms', expRatio: 1.0}, {muscle: 'chest', expRatio: 0.6}, {muscle: 'shoulder', expRatio: 0.3}] },
  
  // お尻 (Glutes)
  { id: 'hip_thrust', name: 'ヒップスラスト', primaryMuscle: 'glutes', targets: [{muscle: 'glutes', expRatio: 1.0}, {muscle: 'hamstrings', expRatio: 0.4}] },
  { id: 'back_kick', name: 'バックキック', primaryMuscle: 'glutes', isBodyweight: true, targets: [{muscle: 'glutes', expRatio: 1.0}, {muscle: 'hamstrings', expRatio: 0.3}] },
  { id: 'bulgarian_squat', name: 'ブルガリアンスクワット', primaryMuscle: 'glutes', isBodyweight: true, targets: [{muscle: 'glutes', expRatio: 1.0}, {muscle: 'legs', expRatio: 0.8}, {muscle: 'hamstrings', expRatio: 0.5}] },
  
  // 中殿筋 (Gluteus Medius)
  { id: 'abduction', name: 'アブダクション', primaryMuscle: 'gluteus_medius', targets: [{muscle: 'gluteus_medius', expRatio: 1.0}] },
  { id: 'clamshell', name: 'クラムシェル', primaryMuscle: 'gluteus_medius', isBodyweight: true, targets: [{muscle: 'gluteus_medius', expRatio: 1.0}] },
  
  // 脚 (Legs)
  { id: 'squat', name: 'スクワット', primaryMuscle: 'legs', isBodyweight: true, targets: [{muscle: 'legs', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.8}, {muscle: 'hamstrings', expRatio: 0.5}, {muscle: 'erector_spinae', expRatio: 0.3}] },
  { id: 'leg_press', name: 'レッグプレス', primaryMuscle: 'legs', targets: [{muscle: 'legs', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.6}] },
  { id: 'leg_extension', name: 'レッグエクステンション', primaryMuscle: 'legs', targets: [{muscle: 'legs', expRatio: 1.0}] },
  { id: 'lunge', name: 'ランジ', primaryMuscle: 'legs', isBodyweight: true, targets: [{muscle: 'legs', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.9}, {muscle: 'hamstrings', expRatio: 0.6}] },
  
  // ハムストリングス (Hamstrings)
  { id: 'leg_curl', name: 'レッグカール', primaryMuscle: 'hamstrings', targets: [{muscle: 'hamstrings', expRatio: 1.0}] },
  { id: 'romanian_deadlift', name: 'ルーマニアンデッドリフト', primaryMuscle: 'hamstrings', targets: [{muscle: 'hamstrings', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.8}, {muscle: 'erector_spinae', expRatio: 0.6}] },
  
  // 腹直筋 (Abs)
  { id: 'crunch', name: 'クランチ', primaryMuscle: 'abs', isBodyweight: true, targets: [{muscle: 'abs', expRatio: 1.0}] },
  { id: 'ab_roller', name: '腹筋ローラー (アブローラー)', primaryMuscle: 'abs', isBodyweight: true, targets: [{muscle: 'abs', expRatio: 1.0}, {muscle: 'transversus_abdominis', expRatio: 0.8}, {muscle: 'back', expRatio: 0.4}] },
  
  // 腹斜筋 (Obliques)
  { id: 'side_crunch', name: 'サイドクランチ', primaryMuscle: 'obliques', isBodyweight: true, targets: [{muscle: 'obliques', expRatio: 1.0}, {muscle: 'abs', expRatio: 0.4}] },
  { id: 'russian_twist', name: 'ロシアンツイスト', primaryMuscle: 'obliques', isBodyweight: true, targets: [{muscle: 'obliques', expRatio: 1.0}, {muscle: 'abs', expRatio: 0.5}] },
  
  // 腸腰筋 (Iliopsoas)
  { id: 'bicycle_crunch', name: 'バイシクルクランチ', primaryMuscle: 'iliopsoas', isBodyweight: true, targets: [{muscle: 'obliques', expRatio: 1.0}, {muscle: 'iliopsoas', expRatio: 0.8}, {muscle: 'abs', expRatio: 0.6}] },
  { id: 'leg_raise', name: 'レッグレイズ', primaryMuscle: 'iliopsoas', isBodyweight: true, targets: [{muscle: 'iliopsoas', expRatio: 1.0}, {muscle: 'abs', expRatio: 0.8}] },
  
  // 腹横筋 (Transversus Abdominis)
  { id: 'draw_in', name: 'ドローイン (自重設定)', primaryMuscle: 'transversus_abdominis', isBodyweight: true, targets: [{muscle: 'transversus_abdominis', expRatio: 1.0}] },
  { id: 'plank', name: 'プランク (自重設定)', primaryMuscle: 'transversus_abdominis', isBodyweight: true, targets: [{muscle: 'transversus_abdominis', expRatio: 1.0}, {muscle: 'abs', expRatio: 0.5}, {muscle: 'shoulder', expRatio: 0.2}, {muscle: 'arms', expRatio: 0.2}] },
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

interface MuscleDetail {
  description: string;
  effectiveExercises: string[];
  trivia: string;
}

const MUSCLE_DETAILS: Record<MuscleType, MuscleDetail> = {
  chest: {
    description: "胸板を形成する強靭な筋肉。上半身の厚みを作り、たくましいシルエットを生み出します。",
    effectiveExercises: ["ベンチプレス", "腕立て伏せ", "ダンベルフライ"],
    trivia: "大胸筋は上部・中部・下部の3つの線維に分かれており、角度を変えて鍛えることでより立体的になります。"
  },
  back: {
    description: "背中を広く覆う巨大な筋肉。逆三角形の体型を作るために最も重要な部位です。",
    effectiveExercises: ["懸垂（チンニング）", "ラットプルダウン", "デッドリフト"],
    trivia: "広背筋は人体で最も面積が広い筋肉。発達すると脇の下から羽が生えたように見えます。"
  },
  shoulder: {
    description: "肩の丸みを作る筋肉。肩幅を広くし、小顔効果も期待できる重要な部位です。",
    effectiveExercises: ["ショルダープレス", "サイドレイズ", "フロントレイズ"],
    trivia: "三角筋は前部・中部・後部に分かれており、実は上半身の中で一番体積が大きい筋肉です。"
  },
  arms: {
    description: "力強さの象徴である腕の筋肉。上腕二頭筋（力こぶ）と上腕三頭筋（二の腕）からなります。",
    effectiveExercises: ["アームカール", "フレンチプレス", "ディップス"],
    trivia: "腕の太さを出したい場合、力こぶ（二頭筋）よりも裏側の三頭筋を鍛える方が効率的です（腕の体積の2/3を占めます）。"
  },
  glutes: {
    description: "お尻のふくらみを作る人体最大の筋肉。歩行やダッシュなどあらゆる動作の要となります。",
    effectiveExercises: ["スクワット", "ヒップスラスト", "ブルガリアンスクワット"],
    trivia: "大臀筋は単一の筋肉としては人体で最も体積が大きく、最も強力なパワーを生み出します。"
  },
  legs: {
    description: "太ももの前側にある強靭な筋肉。立ち上がったり歩いたりする人間の基本動作を支えます。",
    effectiveExercises: ["スクワット", "レッグプレス", "レッグエクステンション"],
    trivia: "大腿四頭筋はその名の通り4つの筋肉の集合体で、全身の筋肉の中で最も強い力を発揮できます。"
  },
  abs: {
    description: "お腹の正面にある筋肉。いわゆる「シックスパック」を形成し、体幹を曲げる働きをします。",
    effectiveExercises: ["クランチ", "腹筋ローラー", "レッグレイズ"],
    trivia: "実は腹直筋は最初から割れています。上に乗っている脂肪が落ちることで、その割れ目が見えるようになります。"
  },
  obliques: {
    description: "お腹の横側にある筋肉。くびれを作り、体をひねる動作で強く働きます。",
    effectiveExercises: ["サイドクランチ", "ロシアンツイスト"],
    trivia: "腹斜筋が発達すると、腹直筋の横に斜めの美しいライン（Vシェイプ）が浮かび上がります。"
  },
  iliopsoas: {
    description: "上半身と下半身を繋ぐ唯一の筋肉群。太ももを持ち上げる動作に不可欠です。",
    effectiveExercises: ["バイシクルクランチ", "レッグレイズ"],
    trivia: "黒人アスリートは腸腰筋が日本人の約3倍も太いと言われており、これが脅威のバネの秘密です。"
  },
  transversus_abdominis: {
    description: "お腹の最も深層にある「天然のコルセット」。内臓を支え、ぽっこりお腹を防ぎます。",
    effectiveExercises: ["プランク", "ドローイン"],
    trivia: "激しい運動をしなくても、日常生活で「お腹をへこませる」だけで鍛えられる唯一の筋肉です。"
  },
  trapezius: {
    description: "首から背中の中央まで広がる筋肉。肩甲骨を動かし、首を支える役割を持ちます。",
    effectiveExercises: ["シュラッグ", "アップライトロウ"],
    trivia: "肩こりの主な原因となる筋肉です。適度に鍛えて血流を良くすることで肩こり解消に繋がります。"
  },
  erector_spinae: {
    description: "背骨に沿って縦に走る筋肉群。良い姿勢を保つために24時間働き続けています。",
    effectiveExercises: ["バックエクステンション", "デッドリフト"],
    trivia: "直立二足歩行をする人類にとって最も重要で、最も疲労が溜まりやすい筋肉の一つです。"
  },
  hamstrings: {
    description: "太ももの裏側にある筋肉群。ブレーキの役割を果たし、肉離れが起きやすい部位です。",
    effectiveExercises: ["レッグカール", "ルーマニアンデッドリフト"],
    trivia: "「ハム（豚のもも肉）のひも」という語源の通り、昔は豚を吊るす際にこの筋肉の腱を使っていたそうです。"
  },
  rhomboids: {
    description: "肩甲骨と背骨の間にある筋肉。肩甲骨を寄せる働きをし、猫背の予防に極めて重要です。",
    effectiveExercises: ["シーテッドロウ", "ワンハンドロウ"],
    trivia: "デスクワークが長い人はここが伸びきって弱まりがち。鍛えることで胸を張った美しい姿勢になります。"
  },
  gluteus_medius: {
    description: "お尻の横側にある筋肉。片足立ちの際に骨盤を水平に保ち、体のバランスを制御します。",
    effectiveExercises: ["アブダクション", "クラムシェル"],
    trivia: "歩くときに体が左右に揺れてしまう人は、この中殿筋が弱っているサインかもしれません。"
  },
};

const MUSCLE_RECOVERY_HOURS: Record<MuscleType, number> = {
  chest: 72,
  back: 72,
  erector_spinae: 72,
  legs: 72,
  hamstrings: 72,
  glutes: 72,
  rhomboids: 72,
  
  shoulder: 48,
  arms: 48,
  trapezius: 48,
  gluteus_medius: 48,
  
  abs: 24,
  obliques: 24,
  transversus_abdominis: 24,
  iliopsoas: 24,
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

function ResultRow({ detail }: { detail: RecordResultDetail }) {
  const [currentExp, setCurrentExp] = useState(detail.oldExp);
  const [currentLevel, setCurrentLevel] = useState(detail.oldLevel);
  const [isFlashing, setIsFlashing] = useState(false);
  const [didLevelUp, setDidLevelUp] = useState(false);

  useEffect(() => {
    let exp = detail.oldExp;
    let lvl = detail.oldLevel;
    let added = 0;

    const interval = setInterval(() => {
      if (added >= detail.gainedExp) {
        clearInterval(interval);
        return;
      }
      
      const step = Math.max(1, Math.ceil(detail.gainedExp / 80));
      added += step;
      if (added > detail.gainedExp) {
        exp -= (added - detail.gainedExp);
        added = detail.gainedExp;
      }
      
      exp += step;
      
      let required = getRequiredExp(lvl);
      if (exp >= required) {
        exp -= required;
        lvl++;
        setIsFlashing(true);
        setDidLevelUp(true);
        setTimeout(() => setIsFlashing(false), 500);
      }
      
      setCurrentExp(exp);
      setCurrentLevel(lvl);
    }, 30);
    
    return () => clearInterval(interval);
  }, [detail]);

  const required = getRequiredExp(currentLevel);
  const percent = Math.min(100, (currentExp / required) * 100);
  const phase = getEvolutionPhase(currentLevel);

  return (
    <div className="result-row" style={{ display: 'flex', alignItems: 'center' }}>
      <img 
        src={`/assets/${detail.muscle}_${phase}.png`} 
        alt={MUSCLE_NAMES[detail.muscle]} 
        style={{ width: '50px', height: '50px', objectFit: 'contain', marginRight: '15px' }} 
      />
      <div style={{ flex: 1 }}>
        <div className="result-muscle-name">
          {MUSCLE_NAMES[detail.muscle]}
          <span className="result-exp-text">
            Lv.{currentLevel} <span style={{ fontWeight: 'bold', color: '#39ff14' }}>(+{detail.gainedExp} EXP)</span>
            {detail.isOverworked && <span style={{ color: 'orange', marginLeft: '4px', fontSize: '0.8rem' }}>(疲労半減)</span>}
            {detail.isProteinBonus && <span style={{ color: '#00ffff', marginLeft: '4px', fontSize: '0.8rem' }}>(🥤 x1.3)</span>}
          </span>
          {didLevelUp && <span className="result-level-up-text">LEVEL UP!</span>}
        </div>
        <div className="result-bar-container">
          <div 
            className={`result-bar-fill ${isFlashing ? 'result-bar-flash' : ''}`}
            style={{ width: `${percent}%`, transition: isFlashing ? 'none' : 'width 0.1s linear' }}
          />
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('characters');

  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

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

  const [evolutionAlerts, setEvolutionAlerts] = useState<{ muscle: MuscleType, phase: number }[]>([]);
  const [bestPumpAlert, setBestPumpAlert] = useState<MuscleType | null>(null);
  const [overworkAlerts, setOverworkAlerts] = useState<MuscleType[]>([]);
  const [detrainAlert, setDetrainAlert] = useState<string[]>([]);
  const [selectedMuscleInfo, setSelectedMuscleInfo] = useState<MuscleType | null>(null);
  const [recordSuccess, setRecordSuccess] = useState(false);
  const [recordResult, setRecordResult] = useState<{ details: RecordResultDetail[], isBestPump: boolean } | null>(null);
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [achievementAlert, setAchievementAlert] = useState<Achievement | null>(null);

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

  useEffect(() => {
    const savedUnlocked = localStorage.getItem('unlockedAchievements');
    if (savedUnlocked) setUnlockedAchievements(JSON.parse(savedUnlocked));
    const savedTitle = localStorage.getItem('selectedTitle');
    if (savedTitle) setSelectedTitle(savedTitle);
  }, []);

  useEffect(() => {
    localStorage.setItem('unlockedAchievements', JSON.stringify(unlockedAchievements));
  }, [unlockedAchievements]);

  useEffect(() => {
    if (selectedTitle) localStorage.setItem('selectedTitle', selectedTitle);
  }, [selectedTitle]);

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

    // 1セットあたり 30 EXP を基本とする
    let baseGainedExp = s * 30;

    const isBestPump = (r >= 8 && r <= 12 && s >= 3 && s <= 5);
    if (isBestPump) {
      baseGainedExp = Math.floor(baseGainedExp * 1.5);
      setBestPumpAlert(selectedExercise.primaryMuscle);
      setTimeout(() => setBestPumpAlert(null), 2500);
    }

    const details: RecordResultDetail[] = [];
    const newEvolutions: { muscle: MuscleType, phase: number }[] = [];
    const newOverworkedMuscles: MuscleType[] = [];

    setStats(prev => {
      const nextStats = { ...prev };
      
      selectedExercise.targets.forEach(target => {
        const muscle = target.muscle;
        const current = nextStats[muscle];
        const oldExp = current.exp;
        const oldLevel = current.level;

        // 超回復（ペナルティ）とプロテインボーナスの判定
        let expToAdd = Math.max(1, Math.floor(baseGainedExp * target.expRatio));
        const requiredRecoveryMs = MUSCLE_RECOVERY_HOURS[muscle] * 60 * 60 * 1000;
        const timeSinceLastTraining = Date.now() - (current.lastTrainedAt || 0);
        
        let isOverworked = false;
        let isProteinBonus = false;

        // 初回プレイ時（lastTrainedAtが初期状態の0など）は除外するため、少し経過している前提
        if ((current.lastTrainedAt || 0) > 0 && timeSinceLastTraining < requiredRecoveryMs) {
          expToAdd = Math.max(1, Math.floor(expToAdd * 0.5));
          isOverworked = true;
          if (!newOverworkedMuscles.includes(muscle)) {
            newOverworkedMuscles.push(muscle);
          }
        } else if (current.hasProteinBonus) {
          // 休息完了後にプロテインボーナスが適用される
          expToAdd = Math.max(1, Math.floor(expToAdd * 1.3));
          isProteinBonus = true;
        }
        
        let newExp = current.exp + expToAdd;
        let newLevel = current.level;
        let didLevelUp = false;

        while (newExp >= getRequiredExp(newLevel)) {
          newExp -= getRequiredExp(newLevel);
          newLevel++;
          didLevelUp = true;
        }

        let evolutionPhase: number | undefined;

        if (didLevelUp) {
          const oldPhase = getEvolutionPhase(current.level);
          const newPhase = getEvolutionPhase(newLevel);

          if (newPhase > oldPhase) {
            evolutionPhase = newPhase;
            newEvolutions.push({ muscle, phase: newPhase });
          }
        }

        details.push({
          muscle,
          oldExp,
          oldLevel,
          newExp,
          newLevel,
          gainedExp: expToAdd,
          isOverworked,
          isProteinBonus,
          evolutionPhase
        });

        nextStats[muscle] = {
          level: newLevel,
          exp: newExp,
          lastTrainedAt: Date.now(),
          hasProteinBonus: false // プロテイン効果を消費
        };
      });
      return nextStats;
    });
    
    if (newOverworkedMuscles.length > 0) {
      setOverworkAlerts(newOverworkedMuscles);
    }

    // We need nextStats reference outside for achievement check. 
    // Since setStats is async, we simulate it here for check.
    const nextStatsToUse = { ...stats };
    selectedExercise.targets.forEach(target => {
       const muscle = target.muscle;
       const detail = details.find(d => d.muscle === muscle);
       if(detail) {
         nextStatsToUse[muscle] = {
            level: detail.newLevel,
            exp: detail.newExp,
            lastTrainedAt: Date.now()
         };
       }
    });

    setRecordResult({ details, isBestPump });

    if (newEvolutions.length > 0) {
      setEvolutionAlerts(prev => [...prev, ...newEvolutions]);
    }

    const newLog: TrainingLog = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      exerciseName: selectedExercise.name,
      weight: w,
      reps: r,
      sets: s,
      isBodyweight: isBodyweight,
      gainedExp: baseGainedExp
    };

    setTrainingLogs(prev => [newLog, ...prev]);

    setUnlockedAchievements(prevUnlocked => {
      const newlyUnlocked: Achievement[] = [];
      const updatedLogs = [newLog, ...trainingLogs];
      let finalUnlocked = [...prevUnlocked];
      
      ACHIEVEMENTS.forEach(ach => {
        if (!finalUnlocked.includes(ach.id) && ach.check(nextStatsToUse, updatedLogs)) {
          newlyUnlocked.push(ach);
          finalUnlocked.push(ach.id);
        }
      });
      
      if (newlyUnlocked.length > 0) {
        setAchievementAlert(newlyUnlocked[0]);
      }
      return finalUnlocked;
    });

    if (!isBodyweight) {
      setWeight('');
    }
    setReps('');
    setSets('');

    setRecordSuccess(true);
    setTimeout(() => setRecordSuccess(false), 2000);
  };

  const closeEvolutionAlert = () => {
    setEvolutionAlerts(prev => prev.slice(1));
  };

  const closeResultModal = () => {
    setRecordResult(null);
  };

  // カレンダーコンポーネントの描画
  const renderCalendar = () => {
    const dataMap = new Map<string, number>();
    
    trainingLogs.forEach(log => {
      const d = new Date(log.timestamp);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dataMap.set(dateStr, (dataMap.get(dateStr) || 0) + log.gainedExp);
    });

    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    
    // その月の1日と末日
    const firstDayOfMonth = new Date(year, month, 1);
    
    // 月曜始まりのインデックス (0: 月, 1: 火 ... 6: 日)
    const jsFirstDay = firstDayOfMonth.getDay();
    const offset = jsFirstDay === 0 ? 6 : jsFirstDay - 1;

    // カレンダーの開始日 (前月の余白部分)
    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(firstDayOfMonth.getDate() - offset);

    // 最大6週 = 42マスで固定
    const WEEKS = 6;
    const totalDays = WEEKS * 7;

    const calendarData: any[] = [];
    const today = new Date();
    today.setHours(0,0,0,0);

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const exp = dataMap.get(dateStr) || 0;
      let level = 0;
      if (exp > 0) level = 1;
      if (exp >= 50) level = 2;
      if (exp >= 150) level = 3;
      if (exp >= 300) level = 4;

      const isCurrentMonth = d.getMonth() === month;
      const isFuture = d.getTime() > today.getTime();

      calendarData.push({
        date: dateStr,
        count: exp,
        level: level,
        isFuture: isFuture,
        isCurrentMonth: isCurrentMonth
      });
    }

    const colors = ['#161b22', '#2e8b57', '#3cb371', '#32cd32', '#39ff14'];
    const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
    const weekLabels = ['1W', '2W', '3W', '4W', '5W', '6W'];

    return (
      <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '100%' }}>
        {/* ナビゲーションヘッダー */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: '280px', marginBottom: '1.5rem' }}>
          <button 
            onClick={() => setCurrentMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem', background: 'rgba(255,255,255,0.1)', minHeight: 'auto' }}
          >
            ◀︎
          </button>
          <div style={{ color: 'var(--text-accent)', fontSize: '1.1rem', fontWeight: 'bold' }}>
            {year}年 {month + 1}月
          </div>
          <button 
            onClick={() => setCurrentMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem', background: 'rgba(255,255,255,0.1)', minHeight: 'auto' }}
          >
            ▶︎
          </button>
        </div>
        
        {/* カレンダー本体 */}
        <div style={{ display: 'grid', gridTemplateColumns: '25px repeat(7, 22px)', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
          <div></div>
          {weekdays.map(day => (
            <div key={day} style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {day}
            </div>
          ))}

          {Array.from({ length: WEEKS }).map((_, weekIndex) => (
            <div style={{ display: 'contents' }} key={`week-${weekIndex}`}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'right', paddingRight: '4px' }}>
                {weekLabels[weekIndex]}
              </div>
              
              {Array.from({ length: 7 }).map((_, dayIndex) => {
                const item = calendarData[weekIndex * 7 + dayIndex];
                const opacity = item.isCurrentMonth ? 1 : 0.15;
                
                return (
                  <div 
                    key={item.date}
                    data-tooltip-id="calendar-tooltip" 
                    data-tooltip-content={`${item.date}: ${item.count} EXP獲得`} 
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '4px',
                      backgroundColor: item.isFuture ? 'rgba(255,255,255,0.02)' : colors[item.level],
                      opacity: opacity,
                      boxShadow: item.level > 0 && !item.isFuture && item.isCurrentMonth ? `0 0 3px ${colors[item.level]}80` : 'none',
                      border: item.isFuture ? '1px dashed rgba(255,255,255,0.1)' : 'none'
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <Tooltip id="calendar-tooltip" />
      </div>
    );
  };
  const handleDrinkProtein = () => {
    let appliedCount = 0;
    setStats(prev => {
      const nextStats = { ...prev };
      Object.keys(nextStats).forEach(key => {
        const muscle = key as MuscleType;
        const current = nextStats[muscle];
        const requiredRecoveryMs = MUSCLE_RECOVERY_HOURS[muscle] * 60 * 60 * 1000;
        const timeSinceLastTraining = Date.now() - (current.lastTrainedAt || 0);
        const isRecovering = (current.lastTrainedAt || 0) > 0 && timeSinceLastTraining < requiredRecoveryMs;
        
        if (isRecovering && !current.hasProteinBonus) {
          nextStats[muscle] = {
            ...current,
            hasProteinBonus: true
          };
          appliedCount++;
        }
      });
      return nextStats;
    });

    if (appliedCount > 0) {
      alert(`${appliedCount}箇所の休息中の筋肉にプロテインボーナスが適用されました！\\n次回のトレーニングで獲得EXPが1.3倍になります！`);
    } else {
      alert(`現在休息中の筋肉がないか、すでに全ての休息中の筋肉にボーナスが適用されています。`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', paddingBottom: '2rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        {selectedTitle && (
          <div style={{ color: '#ffea00', fontWeight: 'bold', fontSize: '1.2rem', marginBottom: '0.5rem', animation: 'float 3s ease-in-out infinite' }}>
            【{selectedTitle}】
          </div>
        )}
        <h1 style={{ color: 'var(--text-primary)', fontSize: '2.5rem', margin: '0' }}>マッスル<br />モンスターズ</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>筋トレで筋肉を育てよう！</p>
      </div>

      {/* Navigation Tabs */}
      <div className="tab-container">
        <button className={`tab-button ${activeTab === 'characters' ? 'active' : ''}`} onClick={() => setActiveTab('characters')}>👾 マスモン</button>
        <button className={`tab-button ${activeTab === 'record' ? 'active' : ''}`} onClick={() => setActiveTab('record')}>🏋️ 筋トレ</button>
        <button className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>📖 ログ</button>
        <button className={`tab-button ${activeTab === 'achievements' ? 'active' : ''}`} onClick={() => setActiveTab('achievements')}>🏆 称号</button>
      </div>



      {/* --- タブコンテンツ：キャラクター --- */}
      {activeTab === 'characters' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          
          {overworkAlerts.length > 0 && (
            <div className="glass-panel" style={{ borderColor: 'orange', backgroundColor: 'rgba(255, 165, 0, 0.1)', textAlign: 'center', marginBottom: '1rem', width: '100%' }}>
              <h3 style={{ color: 'orange' }}>⚠️ オーバーワーク注意！</h3>
              <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>超回復前にトレーニングしたため獲得EXPが半減しました。</p>
              <p style={{ fontWeight: 'bold', margin: '0.5rem 0' }}>{overworkAlerts.map(m => MUSCLE_NAMES[m]).join('、')}</p>
              <button onClick={() => setOverworkAlerts([])} style={{ borderColor: 'orange', color: 'orange', marginTop: '0.5rem', padding: '0.5rem 1rem' }}>確認した</button>
            </div>
          )}

          {detrainAlert.length > 0 && (
            <div className="glass-panel" style={{ borderColor: 'red', backgroundColor: 'rgba(255, 0, 0, 0.1)', textAlign: 'center', marginBottom: '1rem', width: '100%' }}>
              <h3 style={{ color: '#ff4444' }}>⚠️ 筋肉ダウンのお知らせ</h3>
              <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>14日間以上トレーニングをサボったため、筋肉が落ちて（EXP半減）しまいました…</p>
              <p style={{ fontWeight: 'bold', margin: '0.5rem 0' }}>{detrainAlert.join('、')}</p>
              <button onClick={() => setDetrainAlert([])} style={{ borderColor: 'red', color: 'red', marginTop: '0.5rem', padding: '0.5rem 1rem' }}>確認した</button>
            </div>
          )}
          
          {/* プロテインボタン */}
          <div style={{ marginBottom: '2rem', width: '100%', maxWidth: '300px' }}>
            <button 
              onClick={handleDrinkProtein}
              style={{ 
                width: '100%', 
                padding: '12px', 
                backgroundColor: 'rgba(0, 255, 255, 0.1)', 
                borderColor: '#00ffff', 
                color: '#00ffff',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
                fontSize: '1rem',
                fontWeight: 'bold'
              }}
            >
              🥤 プロテインを飲む
            </button>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '8px' }}>
              休息中の筋肉の次回の獲得EXPが1.3倍になります
            </p>
          </div>

          <div style={{ width: '100%' }}>
          {MUSCLE_GROUPS.map(group => (
            <div key={group.id} style={{ marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
                {group.title}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '1rem' }}>
                {group.muscles.map(muscle => {
                  const mStats = stats[muscle];
                  const isBestPump = bestPumpAlert === muscle;
                  const phase = getEvolutionPhase(mStats.level);

                  const requiredRecoveryMs = MUSCLE_RECOVERY_HOURS[muscle] * 60 * 60 * 1000;
                  const timeSinceLastTraining = Date.now() - (mStats.lastTrainedAt || 0);
                  const isRecovering = (mStats.lastTrainedAt || 0) > 0 && timeSinceLastTraining < requiredRecoveryMs;

                  return (
                    <div 
                      key={muscle} 
                      className="glass-panel muscle-card" 
                      onClick={() => setSelectedMuscleInfo(muscle)}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', padding: '0.8rem 0.5rem', cursor: 'pointer', transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
                    >
                      
                      {isBestPump && (
                        <div className="best-pump-badge" style={{ fontSize: '0.8rem', padding: '2px 6px', top: '2px' }}>
                          PUMP!<br/>x1.5
                        </div>
                      )}

                      <h3 style={{ fontSize: '0.9rem', marginBottom: '0.2rem' }}>{MUSCLE_NAMES[muscle]}</h3>
                      <p style={{ color: 'var(--border-highlight)', margin: '0', fontSize: '0.8rem' }}>Lv.{mStats.level}</p>
                      
                      <div style={{ height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0.5rem 0', position: 'relative', width: '100%' }}>
                        <img 
                          src={`/assets/${muscle}_${phase}.png`} 
                          alt={muscle} 
                          className={`monster-image`}
                          style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', filter: isRecovering ? 'brightness(0.6) grayscale(0.4)' : 'none' }}
                        />
                        {isRecovering && (
                          <div style={{ position: 'absolute', top: '-5px', right: '5px', background: 'rgba(0,0,0,0.7)', padding: '2px', borderRadius: '50%', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', border: '1px solid rgba(255,255,255,0.2)' }}>
                            💤
                          </div>
                        )}
                        {mStats.hasProteinBonus && (
                          <div style={{ position: 'absolute', top: '-5px', left: '5px', background: 'rgba(0, 255, 255, 0.2)', padding: '2px', borderRadius: '50%', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', border: '1px solid rgba(0,255,255,0.5)', animation: 'float 2s ease-in-out infinite' }}>
                            🥤
                          </div>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* --- タブコンテンツ：筋トレ記録 --- */}
      {activeTab === 'record' && (
        <div className="glass-panel" style={{ marginTop: '0' }}>
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

          <form onSubmit={handleRecord} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
              <label style={{ fontSize: '1.1rem', color: 'var(--text-accent)' }}>🏋️ トレーニング種目</label>
              <select 
                value={selectedExerciseId} 
                onChange={e => setSelectedExerciseId(e.target.value)}
                style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}
              >
                {EXERCISES.map(ex => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div style={{ display: 'flex', gap: '0.8rem', width: '100%', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                <label style={{ fontSize: '0.9rem', textAlign: 'center' }}>重量 (kg)</label>
                {isBodyweight ? (
                  <input type="text" value={`自重(${bodyWeight})`} disabled style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '1.1rem', padding: '1rem 0' }} />
                ) : (
                  <input type="number" min="0" value={weight} onChange={e => setWeight(Number(e.target.value) || '')} placeholder="0" required style={{ textAlign: 'center', fontSize: '1.2rem', padding: '1rem 0' }} />
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                <label style={{ fontSize: '0.9rem', textAlign: 'center' }}>回数/秒数</label>
                <input type="number" min="1" value={reps} onChange={e => setReps(Number(e.target.value) || '')} required style={{ textAlign: 'center', fontSize: '1.2rem', padding: '1rem 0' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                <label style={{ fontSize: '0.9rem', textAlign: 'center' }}>セット数</label>
                <input type="number" min="1" value={sets} onChange={e => setSets(Number(e.target.value) || '')} required style={{ textAlign: 'center', fontSize: '1.2rem', padding: '1rem 0' }} />
              </div>
            </div>

            <button type="submit" style={{ width: '100%', marginTop: '1rem', padding: '1rem', fontSize: '1.2rem', fontWeight: 'bold' }}>
              💪 記録する
            </button>
          </form>
          
          {recordSuccess && (
            <div style={{ textAlign: 'center', color: '#39ff14', fontWeight: 'bold', marginTop: '1rem', animation: 'scaleIn 0.3s ease-out' }}>
              記録しました！EXP獲得！
            </div>
          )}

          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '1.5rem', lineHeight: '1.6' }}>
            💡 8〜12回、3〜5セットで記録すると「PUMP!」ボーナス！<br />
            ⚠️ 休息中（回復中）の部位を鍛えると、疲労のため獲得EXPが半減します。<br />
            一覧のキャラクターカードで回復完了を確認してから筋トレしましょう！
          </p>
        </div>
      )}

      {/* --- タブコンテンツ：ログ --- */}
      {activeTab === 'logs' && (
        <div className="glass-panel" style={{ marginTop: '0' }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>📖 筋トレ履歴</h2>
          
          {/* 草カレンダー */}
          {renderCalendar()}

          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
            最近の記録
          </h3>
          {trainingLogs.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>まだ記録がありません。トレーニングを開始しましょう！</p>
          ) : (
            <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
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

      {/* Achievements Tab */}
      {activeTab === 'achievements' && (
        <div className="glass-panel" style={{ animation: 'scaleIn 0.3s ease-out' }}>
          <h2 style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>実績と称号</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            {ACHIEVEMENTS.map(ach => {
              const isUnlocked = unlockedAchievements.includes(ach.id);
              const isSelected = selectedTitle === ach.name;
              return (
                <div key={ach.id} style={{ 
                  background: isUnlocked ? 'rgba(0, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                  border: `1px solid ${isUnlocked ? 'var(--border-highlight)' : 'var(--border-color)'}`,
                  padding: '1rem',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  opacity: isUnlocked ? 1 : 0.5
                }}>
                  <div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: isUnlocked ? '#00ffff' : '#8b8bac' }}>
                      {isUnlocked ? ach.name : '？？？'}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {ach.description}
                    </div>
                  </div>
                  {isUnlocked && (
                    <button 
                      onClick={() => setSelectedTitle(isSelected ? null : ach.name)}
                      style={{ 
                        background: isSelected ? 'var(--btn-hover-bg)' : 'var(--btn-bg)', 
                        color: isSelected ? 'var(--btn-hover-text)' : 'var(--btn-text)',
                        padding: '0.5rem 1rem',
                        fontSize: '0.9rem'
                      }}
                    >
                      {isSelected ? 'はずす' : 'セット'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Result Modal Overlay */}
      {recordResult && (
        <div className="modal-overlay" style={{ zIndex: 1001 }}>
          <div className="modal-content result-modal-content glass-panel" style={{ textAlign: 'center', animation: 'scaleIn 0.3s ease-out' }}>
            <h1 style={{ color: '#ffea00', fontSize: '2rem', marginBottom: '1rem' }}>TRAINING COMPLETE!</h1>
            {recordResult.isBestPump && (
              <p style={{ color: '#ff00ff', fontWeight: 'bold', marginBottom: '1rem', animation: 'pulse 1s infinite' }}>
                ⭐ BEST PUMP BONUS (x1.5 EXP) ⭐
              </p>
            )}
            
            <div style={{ maxHeight: '60vh', overflowY: 'auto', marginBottom: '1.5rem' }}>
              {recordResult.details.map((detail, idx) => (
                <ResultRow key={idx} detail={detail} />
              ))}
            </div>
            
            <button onClick={closeResultModal} style={{ width: '100%', maxWidth: '200px' }}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* Achievement Alert Modal Overlay */}
      {(!recordResult && achievementAlert) && (
        <div className="modal-overlay" style={{ zIndex: 1002 }}>
          <div className="modal-content glass-panel" style={{ textAlign: 'center', animation: 'popUp 0.5s ease-out' }}>
            <h1 style={{ color: '#00ffff', fontSize: '2.5rem', marginBottom: '1rem' }}>🏆 実績解除！ 🏆</h1>
            <p style={{ fontSize: '1.2rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
              {achievementAlert.description}
            </p>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#ffea00', marginBottom: '2rem', padding: '1rem', background: 'rgba(255,234,0,0.1)', borderRadius: '8px', border: '1px solid #ffea00' }}>
              称号「{achievementAlert.name}」を獲得しました！
            </div>
            <button onClick={() => setAchievementAlert(null)} style={{ width: '100%', maxWidth: '200px' }}>
              すごい！
            </button>
          </div>
        </div>
      )}

      {/* Evolution Modal Overlay */}
      {(!recordResult && !achievementAlert && evolutionAlerts.length > 0) && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ textAlign: 'center', animation: 'scaleIn 0.5s ease-out' }}>
            <h1 style={{ color: '#ffea00', fontSize: '3rem', marginBottom: '1rem' }}>進化！！</h1>
            <p style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>
              おめでとう！<br/>{MUSCLE_NAMES[evolutionAlerts[0].muscle]} は 第{evolutionAlerts[0].phase}形態 に進化した！
            </p>
            <img 
              src={`/assets/${evolutionAlerts[0].muscle}_${evolutionAlerts[0].phase}.png`} 
              alt="Evolved Muscle" 
              className="monster-image"
              style={{ maxHeight: '250px', maxWidth: '100%', objectFit: 'contain', marginBottom: '2rem' }}
            />
            <br />
            <button onClick={closeEvolutionAlert} style={{ width: '100%', maxWidth: '200px' }}>
              {evolutionAlerts.length > 1 ? '次へ' : '閉じる'}
            </button>
          </div>
        </div>
      )}

      {/* Muscle Detail Modal Overlay */}
      {selectedMuscleInfo && (
        <div className="modal-overlay" onClick={() => setSelectedMuscleInfo(null)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ textAlign: 'left', animation: 'scaleIn 0.3s ease-out', maxWidth: '400px', width: '90%', padding: '1.5rem' }}>
            <div style={{ marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <h2 style={{ color: 'var(--text-accent)', margin: 0, fontSize: '1.4rem' }}>{MUSCLE_NAMES[selectedMuscleInfo]}</h2>
                <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>Lv.{stats[selectedMuscleInfo].level}</span>
              </div>
              
              {/* EXP Bar */}
              <div style={{ marginBottom: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '2px' }}>
                  <span>EXP</span>
                  <span>{stats[selectedMuscleInfo].exp} / {getRequiredExp(stats[selectedMuscleInfo].level)}</span>
                </div>
                <div className="exp-bar-container" style={{ height: '6px', margin: 0 }}>
                  <div className="exp-bar-fill" style={{ width: `${Math.min(100, (stats[selectedMuscleInfo].exp / getRequiredExp(stats[selectedMuscleInfo].level)) * 100)}%` }}></div>
                </div>
              </div>

              {/* Recovery Bar */}
              {(stats[selectedMuscleInfo].lastTrainedAt || 0) > 0 && (() => {
                const requiredMs = MUSCLE_RECOVERY_HOURS[selectedMuscleInfo] * 60 * 60 * 1000;
                const elapsedMs = Date.now() - stats[selectedMuscleInfo].lastTrainedAt!;
                const isRecovering = elapsedMs < requiredMs;
                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '2px' }}>
                      <span>回復ステータス</span>
                      <span style={{ color: isRecovering ? 'orange' : '#39ff14' }}>{isRecovering ? '休息中' : '完了'}</span>
                    </div>
                    <div className="exp-bar-container" style={{ height: '6px', margin: 0, backgroundColor: 'rgba(255,255,255,0.1)' }}>
                      <div 
                        style={{ 
                          height: '100%', 
                          width: `${Math.min(100, Math.max(0, (elapsedMs / requiredMs) * 100))}%`,
                          backgroundColor: isRecovering ? 'orange' : '#39ff14',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <img 
                src={`/assets/${selectedMuscleInfo}_${getEvolutionPhase(stats[selectedMuscleInfo].level)}.png`} 
                alt={MUSCLE_NAMES[selectedMuscleInfo]} 
                style={{ height: '120px', objectFit: 'contain' }}
              />
            </div>

            <div style={{ marginBottom: '1.2rem' }}>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-accent)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>📖</span> 概要
              </h4>
              <p style={{ fontSize: '0.85rem', lineHeight: '1.5', margin: 0 }}>
                {MUSCLE_DETAILS[selectedMuscleInfo].description}
              </p>
            </div>

            <div style={{ marginBottom: '1.2rem' }}>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-accent)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>💤</span> 休息ステータス
              </h4>
              <div style={{ fontSize: '0.85rem', lineHeight: '1.5', margin: 0 }}>
                超回復の目安: {MUSCLE_RECOVERY_HOURS[selectedMuscleInfo]}時間<br />
                {(() => {
                  const mStats = stats[selectedMuscleInfo];
                  if (!mStats.lastTrainedAt) return <span style={{ color: 'var(--text-secondary)' }}>トレーニング記録なし</span>;
                  const requiredMs = MUSCLE_RECOVERY_HOURS[selectedMuscleInfo] * 60 * 60 * 1000;
                  const elapsedMs = Date.now() - mStats.lastTrainedAt;
                  if (elapsedMs >= requiredMs) {
                    return <span style={{ color: '#39ff14' }}>回復完了！トレーニング可能です</span>;
                  } else {
                    const remainingHours = Math.ceil((requiredMs - elapsedMs) / (60 * 60 * 1000));
                    return (
                      <span style={{ color: 'orange' }}>
                        最後に鍛えた日時: {formatDate(mStats.lastTrainedAt)}<br />
                        回復まであと約 {remainingHours}時間
                      </span>
                    );
                  }
                })()}
              </div>
            </div>

            <div style={{ marginBottom: '1.2rem' }}>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-accent)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>🏋️</span> おすすめトレーニング
              </h4>
              <ul style={{ fontSize: '0.85rem', paddingLeft: '1.5rem', lineHeight: '1.5', margin: 0 }}>
                {MUSCLE_DETAILS[selectedMuscleInfo].effectiveExercises.map(ex => (
                  <li key={ex}>{ex}</li>
                ))}
              </ul>
            </div>

            <div style={{ marginBottom: '1.5rem', background: 'rgba(255,234,0,0.1)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #ffea00' }}>
              <h4 style={{ fontSize: '0.9rem', color: '#ffea00', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>💡</span> Tips
              </h4>
              <p style={{ fontSize: '0.8rem', lineHeight: '1.5', margin: 0 }}>
                {MUSCLE_DETAILS[selectedMuscleInfo].trivia}
              </p>
            </div>

            <button onClick={() => setSelectedMuscleInfo(null)} style={{ width: '100%', height: '40px' }}>閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
