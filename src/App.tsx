import { useState, useEffect, useMemo } from 'react';
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import './index.css';

type MuscleType = 
  | 'chest' | 'back' | 'shoulder' | 'biceps' | 'triceps' | 'brachioradialis' | 'forearm_flexors'
  | 'glutes' | 'legs' | 'hamstrings' | 'gluteus_medius' | 'adductors'
  | 'abs' | 'obliques' | 'iliopsoas' | 'transversus_abdominis'
  | 'trapezius' | 'erector_spinae' | 'rhomboids';

// 第3形態（Lv≥10）到達時に、トレーニング傾向で分岐する「型」
type EvolutionBranch = 'power' | 'endurance' | 'balanced';

interface MuscleStats {
  level: number;
  exp: number;
  lastTrainedAt?: number;
  hasProteinBonus?: boolean;
  proteinBonusMultiplier?: number;
  evolutionBranch?: EvolutionBranch; // 第3形態到達時に一度だけ確定する分岐進化の型
  condition?: number;         // コンディション（調子）0-100。既定100。育成ミスで低下し次回EXPにペナルティ
  conditionUpdatedAt?: number; // サボりによるコンディション減衰を最後に精算した時刻
}

// 全体で保持する連続トレーニング日数（ストリーク）
interface StreakData {
  current: number;  // 現在の連続日数
  best: number;     // 最高記録
  lastDate: string; // 最後にトレーニングした日（toDateString）
}

type AppState = Record<MuscleType, MuscleStats>;

interface ExerciseDef {
  id: string;
  name: string;
  primaryMuscle: MuscleType;
  targets: { muscle: MuscleType; expRatio: number }[];
  isBodyweight?: boolean;
  description?: string;
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
  isSuperComp: boolean;          // 超回復ピーク（適時トレ）ボーナスが適用されたか
  isPoorCondition: boolean;      // コンディション低下によるEXPペナルティが適用されたか
  conditionMultiplier: number;   // コンディションによる倍率（1.0=ペナルティなし）
  conditionLabel?: string;       // ペナルティ時の調子ラベル（例: 疲労）
  evolutionPhase?: number;
  evolutionBranch?: EvolutionBranch; // 第3形態への分岐進化時のみ設定
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

type TabType = 'characters' | 'record' | 'logs' | 'achievements' | 'encyclopedia';

interface Achievement {
  id: string;
  name: string;
  description: string;
  check: (stats: Record<MuscleType, MuscleStats>, logs: TrainingLog[], streak: StreakData) => boolean;
}

// 連続トレーニング日数のマイルストーン。称号（実績）とバナー表示の両方で使う。
// ストリークの報酬はEXPではなく、この称号の獲得（＝「継続」の meta 報酬）。
const STREAK_TITLES: { days: number; id: string; title: string }[] = [
  { days: 3, id: 'streak_3', title: '三日坊主返上' },
  { days: 7, id: 'streak_7', title: '週間皆勤賞' },
  { days: 14, id: 'streak_14', title: '継続は力なり' },
  { days: 30, id: 'streak_30', title: '鉄の習慣' },
];

const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_blood', name: '駆け出しトレーニー', description: '初めてトレーニングを記録する', check: (_, logs) => logs.length > 0 },
  { id: 'habit_3', name: '習慣化への第一歩', description: 'トレーニングを累計3日記録する', check: (_, logs) => new Set(logs.map(l => new Date(l.timestamp).toDateString())).size >= 3 },
  { id: 'habit_7', name: '鉄の意志', description: 'トレーニングを累計7日記録する', check: (_, logs) => new Set(logs.map(l => new Date(l.timestamp).toDateString())).size >= 7 },
  // 連続日数（ストリーク）称号。best を見るので一度達成すれば途切れても解除されない。
  ...STREAK_TITLES.map(m => ({
    id: m.id,
    name: m.title,
    description: `${m.days}日連続でトレーニングする`,
    check: (_s: AppState, _l: TrainingLog[], streak: StreakData) => streak.best >= m.days,
  })),
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
  { id: 'shoulder_arms', title: '💪 肩・腕', muscles: ['shoulder', 'biceps', 'triceps', 'brachioradialis', 'forearm_flexors'] as MuscleType[] },
  { id: 'abs_core', title: '🔥 腹・体幹', muscles: ['abs', 'obliques', 'iliopsoas', 'transversus_abdominis'] as MuscleType[] },
  { id: 'legs_glutes', title: '🦵 脚・お尻', muscles: ['legs', 'hamstrings', 'glutes', 'gluteus_medius', 'adductors'] as MuscleType[] },
];

const EXERCISES: ExerciseDef[] = [
  // 胸 (Chest)
  { id: 'bench_press', name: 'ベンチプレス', primaryMuscle: 'chest', targets: [{muscle: 'chest', expRatio: 1.0}, {muscle: 'triceps', expRatio: 0.5}, {muscle: 'shoulder', expRatio: 0.4}], description: '仰向けになりバーベルを胸まで下ろして押し上げる種目。大胸筋全体を強力に鍛えます。' },
  { id: 'push_up', name: '腕立て伏せ', primaryMuscle: 'chest', isBodyweight: true, targets: [{muscle: 'chest', expRatio: 1.0}, {muscle: 'triceps', expRatio: 0.5}, {muscle: 'abs', expRatio: 0.2}], description: '手を肩幅よりやや広くつき、体を一直線に保ったまま腕の曲げ伸ばしを行います。' },
  { id: 'dumbbell_fly', name: 'ダンベルフライ', primaryMuscle: 'chest', targets: [{muscle: 'chest', expRatio: 1.0}, {muscle: 'shoulder', expRatio: 0.2}], description: '仰向けでダンベルを持ち、鳥が羽ばたくように腕を開閉させ大胸筋をストレッチさせます。' },
  { id: 'chest_press', name: 'チェストプレス', primaryMuscle: 'chest', targets: [{muscle: 'chest', expRatio: 1.0}, {muscle: 'triceps', expRatio: 0.4}], description: 'マシンに座り、グリップを前に押し出して大胸筋を鍛える安全な種目です。' },
  
  // 背中 (Back)
  { id: 'pull_up', name: '懸垂（チンニング）', primaryMuscle: 'back', isBodyweight: true, targets: [{muscle: 'back', expRatio: 1.0}, {muscle: 'biceps', expRatio: 0.6}, {muscle: 'rhomboids', expRatio: 0.4}], description: 'バーにぶら下がり、肩甲骨を寄せるようにして体を持ち上げます。' },
  { id: 'deadlift', name: 'デッドリフト', primaryMuscle: 'back', targets: [{muscle: 'erector_spinae', expRatio: 1.0}, {muscle: 'back', expRatio: 0.8}, {muscle: 'glutes', expRatio: 0.6}, {muscle: 'hamstrings', expRatio: 0.5}], description: '床にあるバーベルを、背筋を伸ばしたまま立ち上がりながら持ち上げる全身運動です。' },
  { id: 'lat_pulldown', name: 'ラットプルダウン', primaryMuscle: 'back', targets: [{muscle: 'back', expRatio: 1.0}, {muscle: 'biceps', expRatio: 0.4}, {muscle: 'rhomboids', expRatio: 0.3}], description: 'マシンに座り、上からバーを胸の前に引き下ろして広背筋を鍛えます。' },
  { id: 'bent_over_row', name: 'ベントオーバーロウ', primaryMuscle: 'back', targets: [{muscle: 'back', expRatio: 1.0}, {muscle: 'rhomboids', expRatio: 0.8}, {muscle: 'erector_spinae', expRatio: 0.5}], description: '前傾姿勢でバーベルやダンベルをお腹に向かって引き上げます。' },
  
  // 僧帽筋 (Trapezius)
  { id: 'shrug', name: 'シュラッグ', primaryMuscle: 'trapezius', targets: [{muscle: 'trapezius', expRatio: 1.0}], description: '両手に重量を持ち、肩をすくめるようにして僧帽筋を鍛えます。' },
  { id: 'upright_row', name: 'アップライトロウ', primaryMuscle: 'trapezius', targets: [{muscle: 'trapezius', expRatio: 1.0}, {muscle: 'shoulder', expRatio: 0.6}], description: 'バーベルやダンベルを体の前に持ち、肘を高く上げるように引き上げます。' },
  
  // 菱形筋 (Rhomboids)
  { id: 'seated_row', name: 'シーテッドロウ', primaryMuscle: 'rhomboids', targets: [{muscle: 'rhomboids', expRatio: 1.0}, {muscle: 'back', expRatio: 0.6}, {muscle: 'biceps', expRatio: 0.4}], description: 'マシンに座り、ケーブルをみぞおちに向かって引き、背中の中央を鍛えます。' },
  { id: 'one_hand_row', name: 'ワンハンドロウ', primaryMuscle: 'rhomboids', targets: [{muscle: 'rhomboids', expRatio: 1.0}, {muscle: 'back', expRatio: 0.8}, {muscle: 'biceps', expRatio: 0.4}], description: 'ベンチに片手と片膝をつき、もう片方の手でダンベルを引き上げます。' },
  
  // 脊柱起立筋 (Erector Spinae)
  { id: 'back_extension', name: 'バックエクステンション', primaryMuscle: 'erector_spinae', isBodyweight: true, targets: [{muscle: 'erector_spinae', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.5}, {muscle: 'hamstrings', expRatio: 0.4}], description: 'うつ伏せの状態から上体を反らし、脊柱起立筋を鍛えます。' },
  { id: 'good_morning', name: 'グッドモーニング', primaryMuscle: 'erector_spinae', targets: [{muscle: 'erector_spinae', expRatio: 1.0}, {muscle: 'hamstrings', expRatio: 0.8}, {muscle: 'glutes', expRatio: 0.6}], description: 'バーベルを肩に担ぎ、背筋を伸ばしたままお辞儀をするように上体を倒します。' },
  
  // 肩 (Shoulder)
  { id: 'back_press', name: 'バックプレス', primaryMuscle: 'shoulder', targets: [{muscle: 'shoulder', expRatio: 1.0}, {muscle: 'triceps', expRatio: 0.4}, {muscle: 'trapezius', expRatio: 0.3}], description: '首の後ろでバーベルを上下させ、三角筋を鍛えます（肩の柔軟性が必要です）。' },
  { id: 'shoulder_press', name: 'ショルダープレス', primaryMuscle: 'shoulder', targets: [{muscle: 'shoulder', expRatio: 1.0}, {muscle: 'triceps', expRatio: 0.5}, {muscle: 'chest', expRatio: 0.2}], description: '鎖骨の前から頭上へダンベルやバーベルを押し上げます。' },
  { id: 'side_raise', name: 'サイドレイズ', primaryMuscle: 'shoulder', targets: [{muscle: 'shoulder', expRatio: 1.0}], description: '両手にダンベルを持ち、腕を横に広げて持ち上げ、肩の横側を鍛えます。' },
  { id: 'front_raise', name: 'フロントレイズ', primaryMuscle: 'shoulder', targets: [{muscle: 'shoulder', expRatio: 1.0}, {muscle: 'chest', expRatio: 0.2}], description: '両手にダンベルを持ち、腕を前に向かって持ち上げ、肩の前側を鍛えます。' },
  
  // 上腕二頭筋 (Biceps)
  { id: 'biceps_curl', name: 'アームカール', primaryMuscle: 'biceps', targets: [{muscle: 'biceps', expRatio: 1.0}, {muscle: 'brachioradialis', expRatio: 0.3}], description: '肘を固定し、バーベルやダンベルを巻き上げるように持ち上げ上腕二頭筋を鍛えます。' },
  { id: 'incline_curl', name: 'インクラインダンベルカール', primaryMuscle: 'biceps', targets: [{muscle: 'biceps', expRatio: 1.0}], description: 'ベンチの背もたれに斜めに寄りかかり、上腕二頭筋を最大伸展させて鍛えます。' },
  { id: 'hammer_curl', name: 'ハンマーカール', primaryMuscle: 'biceps', targets: [{muscle: 'biceps', expRatio: 0.7}, {muscle: 'brachioradialis', expRatio: 1.0}], description: '手のひらを内側（縦）に向けたままダンベルを持ち上げ、腕橈骨筋と二頭筋を同時に鍛えます。' },
  
  // 上腕三頭筋 (Triceps)
  { id: 'french_press', name: 'フレンチプレス', primaryMuscle: 'triceps', targets: [{muscle: 'triceps', expRatio: 1.0}], description: '頭上で重量を持ち、肘を曲げて頭の後ろに下ろし、上腕三頭筋を鍛えます。' },
  { id: 'kick_back', name: 'キックバック', primaryMuscle: 'triceps', targets: [{muscle: 'triceps', expRatio: 1.0}], description: '前傾姿勢で肘を固定し、腕を後ろに伸ばすようにダンベルを動かします。' },
  { id: 'dips', name: 'ディップス', primaryMuscle: 'triceps', isBodyweight: true, targets: [{muscle: 'triceps', expRatio: 1.0}, {muscle: 'chest', expRatio: 0.6}, {muscle: 'shoulder', expRatio: 0.3}], description: '平行なバーに両手をつき、体を沈めてから押し上げる種目です。' },
  { id: 'narrow_bench_press', name: 'ナローベンチプレス', primaryMuscle: 'triceps', targets: [{muscle: 'triceps', expRatio: 1.0}, {muscle: 'chest', expRatio: 0.5}, {muscle: 'shoulder', expRatio: 0.3}], description: '手幅を狭く握って行うベンチプレス。上腕三頭筋に強力な刺激を与えます。' },
  
  // 腕橈骨筋 (Brachioradialis)
  { id: 'reverse_curl', name: 'リバースカール', primaryMuscle: 'brachioradialis', targets: [{muscle: 'brachioradialis', expRatio: 1.0}, {muscle: 'forearm_flexors', expRatio: 0.4}], description: '手のひらを下に向けてバーベルを持ち上げ、前腕上部を集中して鍛えます。' },
  
  // 前腕屈筋群 (Forearm Flexors)
  { id: 'wrist_curl', name: 'リストカール', primaryMuscle: 'forearm_flexors', targets: [{muscle: 'forearm_flexors', expRatio: 1.0}], description: '前腕をベンチに固定し、手首を上に曲げて前腕の内側（屈筋群）を鍛えます。' },
  { id: 'reverse_wrist_curl', name: 'リバースリストカール', primaryMuscle: 'forearm_flexors', targets: [{muscle: 'forearm_flexors', expRatio: 1.0}], description: '手のひらを下に向けて手首を持ち上げ、前腕外側・手首を伸ばす筋肉を鍛えます。' },

  // お尻 (Glutes)
  { id: 'hip_thrust', name: 'ヒップスラスト', primaryMuscle: 'glutes', targets: [{muscle: 'glutes', expRatio: 1.0}, {muscle: 'hamstrings', expRatio: 0.4}], description: '仰向けで肩をベンチに乗せ、バーベルを骨盤に乗せてお尻を持ち上げます。' },
  { id: 'back_kick', name: 'バックキック', primaryMuscle: 'glutes', isBodyweight: true, targets: [{muscle: 'glutes', expRatio: 1.0}, {muscle: 'hamstrings', expRatio: 0.3}], description: '四つん這いになり、片足を後ろへ蹴り上げるようにお尻を収縮させます。' },
  { id: 'bulgarian_squat', name: 'ブルガリアンスクワット', primaryMuscle: 'glutes', isBodyweight: true, targets: [{muscle: 'glutes', expRatio: 1.0}, {muscle: 'legs', expRatio: 0.8}, {muscle: 'hamstrings', expRatio: 0.5}], description: '片足を後ろのベンチに乗せ、もう片方の足で深くしゃがみ込みます。' },
  
  // 中殿筋 (Gluteus Medius)
  { id: 'abduction', name: 'アブダクション', primaryMuscle: 'gluteus_medius', targets: [{muscle: 'gluteus_medius', expRatio: 1.0}], description: 'マシンに座り、膝を外側に開く動きでお尻の横側（中殿筋）を鍛えます。' },
  { id: 'clamshell', name: 'クラムシェル', primaryMuscle: 'gluteus_medius', isBodyweight: true, targets: [{muscle: 'gluteus_medius', expRatio: 1.0}], description: '横向きに寝て、貝殻が開くように上の膝を開き中殿筋を鍛えます。' },
  
  // 脚・大腿四頭筋 (Legs)
  { id: 'squat', name: 'スクワット', primaryMuscle: 'legs', isBodyweight: true, targets: [{muscle: 'legs', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.8}, {muscle: 'hamstrings', expRatio: 0.5}, {muscle: 'erector_spinae', expRatio: 0.3}], description: '足を肩幅に開き、背筋を伸ばしたまま深くしゃがみ込む下半身の王様です。' },
  { id: 'leg_press', name: 'レッグプレス', primaryMuscle: 'legs', targets: [{muscle: 'legs', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.6}], description: 'マシンに座り、足でプレートを押し上げて脚全体を鍛えます。' },
  { id: 'leg_extension', name: 'レッグエクステンション', primaryMuscle: 'legs', targets: [{muscle: 'legs', expRatio: 1.0}], description: 'マシンに座り、膝を伸ばす動きで太ももの前側（大腿四頭筋）を鍛えます。' },
  { id: 'lunge', name: 'ランジ', primaryMuscle: 'legs', isBodyweight: true, targets: [{muscle: 'legs', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.9}, {muscle: 'hamstrings', expRatio: 0.6}], description: '足を前後に開き、後ろの膝が床につく直前まで沈み込んでから立ち上がります。' },
  
  // 股関節内転筋群 (Adductors)
  { id: 'wide_squat', name: 'ワイドスクワット', primaryMuscle: 'adductors', isBodyweight: true, targets: [{muscle: 'adductors', expRatio: 1.0}, {muscle: 'legs', expRatio: 0.8}, {muscle: 'glutes', expRatio: 0.6}], description: '足幅を広めに開き、つま先を外側に向けて行うスクワット。内もも（内転筋）を強力に刺激します。' },
  { id: 'adduction', name: 'アダクション', primaryMuscle: 'adductors', targets: [{muscle: 'adductors', expRatio: 1.0}], description: '専用マシンに座り、両脚を外側から内側に閉じる動きで内転筋群を集中強化します。' },
  { id: 'side_lunge', name: 'サイドランジ', primaryMuscle: 'adductors', isBodyweight: true, targets: [{muscle: 'adductors', expRatio: 1.0}, {muscle: 'legs', expRatio: 0.7}, {muscle: 'glutes', expRatio: 0.5}], description: '横方向に大きく一歩を踏み出し、股関節を折りたたんで内ももと太ももを鍛えます。' },
  { id: 'copenhagen_plank', name: 'コペンハーゲンプランク', primaryMuscle: 'adductors', isBodyweight: true, targets: [{muscle: 'adductors', expRatio: 1.0}, {muscle: 'obliques', expRatio: 0.5}], description: 'ベンチに片足を乗せて横向きで体を支える自重種目。内もものインナーマッスルを鍛えます。' },

  // ハムストリングス (Hamstrings)
  { id: 'leg_curl', name: 'レッグカール', primaryMuscle: 'hamstrings', targets: [{muscle: 'hamstrings', expRatio: 1.0}], description: 'マシンにうつ伏せになり、膝を曲げてかかとをお尻に近づけハムストリングスを鍛えます。' },
  { id: 'romanian_deadlift', name: 'ルーマニアンデッドリフト', primaryMuscle: 'hamstrings', targets: [{muscle: 'hamstrings', expRatio: 1.0}, {muscle: 'glutes', expRatio: 0.8}, {muscle: 'erector_spinae', expRatio: 0.6}], description: '膝を軽く曲げたまま、お尻を後ろに引きながら上体を倒し裏ももを伸ばします。' },
  
  // 腹直筋 (Abs)
  { id: 'crunch', name: 'クランチ', primaryMuscle: 'abs', isBodyweight: true, targets: [{muscle: 'abs', expRatio: 1.0}], description: '仰向けになり、腰を床につけたままおへそを覗き込むように上体を丸めます。' },
  { id: 'ab_roller', name: '腹筋ローラー (アブローラー)', primaryMuscle: 'abs', isBodyweight: true, targets: [{muscle: 'abs', expRatio: 1.0}, {muscle: 'transversus_abdominis', expRatio: 0.8}, {muscle: 'back', expRatio: 0.4}], description: '膝をついてローラーを持ち、体を前に伸ばしてから元の位置に戻ります。' },
  
  // 腹斜筋 (Obliques)
  { id: 'side_crunch', name: 'サイドクランチ', primaryMuscle: 'obliques', isBodyweight: true, targets: [{muscle: 'obliques', expRatio: 1.0}, {muscle: 'abs', expRatio: 0.4}], description: '横向きに寝て、脇腹を縮めるように上体を起こします。' },
  { id: 'russian_twist', name: 'ロシアンツイスト', primaryMuscle: 'obliques', isBodyweight: true, targets: [{muscle: 'obliques', expRatio: 1.0}, {muscle: 'abs', expRatio: 0.5}], description: '体育座りの姿勢で少し上体を倒し、胴体を左右にひねります。' },
  
  // 腸腰筋 (Iliopsoas)
  { id: 'bicycle_crunch', name: 'バイシクルクランチ', primaryMuscle: 'iliopsoas', isBodyweight: true, targets: [{muscle: 'obliques', expRatio: 1.0}, {muscle: 'iliopsoas', expRatio: 0.8}, {muscle: 'abs', expRatio: 0.6}], description: '仰向けで自転車を漕ぐように足を動かし、対角の肘と膝を近づけます。' },
  { id: 'leg_raise', name: 'レッグレイズ', primaryMuscle: 'iliopsoas', isBodyweight: true, targets: [{muscle: 'iliopsoas', expRatio: 1.0}, {muscle: 'abs', expRatio: 0.8}], description: '仰向けで足を揃え、床から垂直になるまで下腹部の力で持ち上げます。' },
  
  // 腹横筋 (Transversus Abdominis)
  { id: 'draw_in', name: 'ドローイン (自重設定)', primaryMuscle: 'transversus_abdominis', isBodyweight: true, targets: [{muscle: 'transversus_abdominis', expRatio: 1.0}], description: 'お腹を極限までへこませ、その状態をキープしてインナーマッスルを鍛えます。' },
  { id: 'plank', name: 'プランク (自重設定)', primaryMuscle: 'transversus_abdominis', isBodyweight: true, targets: [{muscle: 'transversus_abdominis', expRatio: 1.0}, {muscle: 'abs', expRatio: 0.5}, {muscle: 'shoulder', expRatio: 0.2}, {muscle: 'triceps', expRatio: 0.2}], description: '肘とつま先で体を支え、体が一直線になる姿勢をキープします。' },
];

const INITIAL_STATE: AppState = {
  chest: { level: 1, exp: 0 },
  back: { level: 1, exp: 0 },
  shoulder: { level: 1, exp: 0 },
  biceps: { level: 1, exp: 0 },
  triceps: { level: 1, exp: 0 },
  brachioradialis: { level: 1, exp: 0 },
  forearm_flexors: { level: 1, exp: 0 },
  glutes: { level: 1, exp: 0 },
  legs: { level: 1, exp: 0 },
  hamstrings: { level: 1, exp: 0 },
  gluteus_medius: { level: 1, exp: 0 },
  adductors: { level: 1, exp: 0 },
  abs: { level: 1, exp: 0 },
  obliques: { level: 1, exp: 0 },
  iliopsoas: { level: 1, exp: 0 },
  transversus_abdominis: { level: 1, exp: 0 },
  trapezius: { level: 1, exp: 0 },
  erector_spinae: { level: 1, exp: 0 },
  rhomboids: { level: 1, exp: 0 },
};

const MUSCLE_NAMES: Record<MuscleType, string> = {
  chest: '大胸筋',
  back: '広背筋',
  shoulder: '三角筋',
  biceps: '上腕二頭筋',
  triceps: '上腕三頭筋',
  brachioradialis: '腕橈骨筋',
  forearm_flexors: '前腕屈筋群',
  glutes: '大臀筋',
  legs: '大腿四頭筋',
  hamstrings: 'ハムストリングス',
  gluteus_medius: '中殿筋',
  adductors: '股関節内転筋群',
  abs: '腹直筋',
  obliques: '腹斜筋',
  iliopsoas: '腸腰筋',
  transversus_abdominis: '腹横筋',
  trapezius: '僧帽筋',
  erector_spinae: '脊柱起立筋',
  rhomboids: '菱形筋',
};

const MUSCLE_READINGS: Record<MuscleType, string> = {
  chest: 'だいきょうきん',
  back: 'こうはいきん',
  shoulder: 'さんかくきん',
  biceps: 'じょうわんにとうきん',
  triceps: 'じょうわんさんとうきん',
  brachioradialis: 'わんとうこつきん',
  forearm_flexors: 'ぜんわんくっきんぐん',
  glutes: 'だいでんきん',
  legs: 'だいたいしとうきん',
  hamstrings: 'ハムストリングス',
  gluteus_medius: 'ちゅうでんきん',
  adductors: 'こかんせつないてんきんぐん',
  abs: 'ふくちょくきん',
  obliques: 'ふくしゃきん',
  iliopsoas: 'ちょうようきん',
  transversus_abdominis: 'ふくおうきん',
  trapezius: 'そうぼうきん',
  erector_spinae: 'せきちゅうきりつきん',
  rhomboids: 'りょうけいきん',
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
  biceps: {
    description: "力こぶを形成する腕の筋肉。肘を曲げる動作で主に使用され、引き締まった太い腕を作ります。",
    effectiveExercises: ["アームカール", "インクラインダンベルカール", "ハンマーカール"],
    trivia: "手のひらを上に向けた状態で肘を曲げると上腕二頭筋に最も強い刺激が入ります。"
  },
  triceps: {
    description: "二の腕の裏側を占める上半身の腕で最も大きい筋肉。肘を伸ばす動作を司り、腕全体の太さを決めます。",
    effectiveExercises: ["フレンチプレス", "キックバック", "ディップス", "ナローベンチプレス"],
    trivia: "上腕の体積の約2/3を占めるため、腕を太くたくましくしたい場合は三頭筋の強化が不可欠です。"
  },
  brachioradialis: {
    description: "前腕の上部（親指側）に位置する筋肉。手首を中立位にして肘を曲げる動作で強く働きます。",
    effectiveExercises: ["リバースカール", "ハンマーカール"],
    trivia: "ハンマーカールやリバースカールで集中的に鍛えることができ、腕全体の厚みを増す隠れた重要部位です。"
  },
  forearm_flexors: {
    description: "前腕の内側に位置し、手首を曲げる動作や強力な握力を生み出す筋肉群です。",
    effectiveExercises: ["リストカール", "リバースリストカール"],
    trivia: "日常のあらゆる物を握る動作に関与しており、高重量のデッドリフトや懸垂を支える基盤となります。"
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
  adductors: {
    description: "太ももの内側に位置する筋肉群。足を閉じる動作や骨盤の安定、美脚に関与します。",
    effectiveExercises: ["ワイドスクワット", "アダクション", "サイドランジ", "コペンハーゲンプランク"],
    trivia: "内ももの引き締めに直結する筋肉で、ワイドスクワットや専用マシンで効率よく刺激できます。"
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
  adductors: 48,
  
  shoulder: 48,
  biceps: 48,
  triceps: 48,
  brachioradialis: 48,
  trapezius: 48,
  gluteus_medius: 48,
  
  forearm_flexors: 24,
  abs: 24,
  obliques: 24,
  transversus_abdominis: 24,
  iliopsoas: 24,
};

const DETRAIN_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14日間

// ===== コンディション（調子）システム =====
// 「育成ミス」（過剰トレ・サボり）でコンディションが下がり、次回の獲得EXPにペナルティ倍率が
// かかる。マイナスにはならず（レベルは絶対に下がらない）、適切なトレーニングで回復できる。
const MAX_CONDITION = 100;
const CONDITION_OVERWORK_PENALTY = 30;   // 過剰トレ（超回復前）1回あたりの低下量
const CONDITION_TRAIN_RECOVERY = 25;     // 適切なトレーニング1回あたりの回復量
const CONDITION_SABORI_GRACE_FACTOR = 2; // 回復時間×この倍率を過ぎたらサボり扱いで減衰開始
const CONDITION_SABORI_DECAY_PER_DAY = 8; // サボり1日あたりのコンディション低下量

// ===== 超回復ピーク（適時トレ）ボーナス =====
// 回復完了後～サボり圏に入る前の「ちょうど良い」タイミングで鍛えると獲得EXPが増える。
// 「EXPは部位への負荷と連動する」という思想に沿った、部位別・タイミング依存の報酬。
// 時間軸: 早すぎ(超回復前)=過剰トレで半減 / ちょうど良い=超回復ピークで加算 / 遅すぎ=サボりで調子ダウン。
const SUPERCOMP_BONUS = 1.2;

// コンディションの段階。上から順に評価し、condition >= min の最初の段階を採用する。
const CONDITION_TIERS = [
  { min: 90, label: '絶好調', emoji: '😤', color: '#39ff14', multiplier: 1.0 },
  { min: 65, label: '好調',   emoji: '💪', color: '#00e5ff', multiplier: 1.0 },
  { min: 40, label: '普通',   emoji: '😐', color: '#ffd23f', multiplier: 1.0 },
  { min: 20, label: '疲労',   emoji: '😓', color: '#ff9f1c', multiplier: 0.8 },
  { min: 0,  label: '絶不調', emoji: '🤕', color: '#ff4d4d', multiplier: 0.6 },
] as const;

type ConditionTier = (typeof CONDITION_TIERS)[number];

function getConditionTier(condition: number): ConditionTier {
  const c = Math.max(0, Math.min(MAX_CONDITION, condition));
  return CONDITION_TIERS.find(t => c >= t.min) ?? CONDITION_TIERS[CONDITION_TIERS.length - 1];
}

// ===== 連続トレーニング日数（ストリーク）システム =====
// 毎日「何かしら」トレーニングを続けると伸び、1日でも空くと途切れる。部位を問わない
// 「継続ログイン」の習慣化メカニクス。報酬はEXPではなく称号（STREAK_TITLES）で、
// 部位EXPの「負荷連動」思想を汚さないように分離している。
// 次に狙える連続日数の称号マイルストーンを返す（全て達成済みなら null）。
function getNextStreakMilestone(streak: StreakData): { days: number; title: string } | null {
  return STREAK_TITLES.find(m => streak.best < m.days) ?? null;
}

// 2つの日付文字列（toDateString）の差を日数で返す。to - from。
function dayDiff(fromDateStr: string, toDateStr: string): number {
  const from = new Date(fromDateStr);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toDateStr);
  to.setHours(0, 0, 0, 0);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

// 表示用の実効ストリーク。今日か昨日に記録があれば継続中、2日以上空いていれば途切れて0。
function getEffectiveStreak(data: StreakData, nowMs: number): number {
  if (!data.lastDate) return 0;
  const diff = dayDiff(data.lastDate, new Date(nowMs).toDateString());
  return diff <= 1 ? data.current : 0;
}

function getRequiredExp(level: number) {
  return level * 100;
}

function getEvolutionPhase(level: number): 1 | 2 | 3 {
  if (level < 5) return 1;
  if (level < 10) return 2;
  return 3;
}

// 各進化フェーズの表示情報（図鑑用）。unlockLevel はそのフェーズに到達する最低レベル。
const PHASE_INFO: Record<1 | 2 | 3, { label: string; stage: string; unlockLevel: number }> = {
  1: { label: '第1形態', stage: '幼年期', unlockLevel: 1 },
  2: { label: '第2形態', stage: '成長期', unlockLevel: 5 },
  3: { label: '第3形態', stage: '完全体', unlockLevel: 10 },
};

// 分岐進化の型ごとの表示情報（ラベル・絵文字・オーラ色・フレーバー）
const BRANCH_INFO: Record<EvolutionBranch, { label: string; emoji: string; color: string; description: string }> = {
  power: {
    label: 'パワー型',
    emoji: '⚔️',
    color: '#ff4d4d',
    description: '低レップ・高重量で鍛え上げた「剛」の進化。爆発的なパワーを宿す。',
  },
  endurance: {
    label: '持久型',
    emoji: '🌀',
    color: '#00e5ff',
    description: '高レップで鍛え抜いた「粘り」の進化。尽きぬスタミナを宿す。',
  },
  balanced: {
    label: 'バランス型',
    emoji: '⭐',
    color: '#ffd23f',
    description: 'バランス良く鍛え上げた「王道」の進化。あらゆる力を高水準で備える。',
  },
};

// スプライト画像パスを一元管理する。第3形態かつ分岐が確定している場合は型別画像
// （/assets/{muscle}_3_{branch}.png）を、それ以外は従来の /assets/{muscle}_{phase}.png を返す。
// 型別画像は現状「仮画像（第3形態画像のコピー）」で、同名ファイルを差し替えれば反映される。
function getSpriteSrc(muscle: MuscleType, phase: 1 | 2 | 3, branch?: EvolutionBranch): string {
  if (phase === 3 && branch) return `/assets/${muscle}_3_${branch}.png`;
  return `/assets/${muscle}_${phase}.png`;
}

// 型別画像が読み込めない（未配置など）場合に、必ず存在する第3形態画像へ退避する。
// 一度退避したら再度 error を起こさないよう dataset でガードし無限ループを防ぐ。
function handleSpriteError(e: React.SyntheticEvent<HTMLImageElement>, muscle: MuscleType) {
  const img = e.currentTarget;
  if (img.dataset.fallback === 'done') return;
  img.dataset.fallback = 'done';
  img.src = `/assets/${muscle}_3.png`;
}

function formatDate(ms: number): string {
  const date = new Date(ms);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  return `${m}/${d} ${hh}:${mm}`;
}

// 種目名から定義を逆引きするマップ（履歴分析でターゲット部位を辿るのに使う）
const EXERCISE_BY_NAME: Record<string, ExerciseDef> = Object.fromEntries(
  EXERCISES.map(ex => [ex.name, ex])
);

// トレーニング傾向（セット数で重み付けした平均レップ数）から分岐進化の型を判定する。
// extra は今回記録したセット（まだ logs に含まれていない分）を反映するための任意引数。
function computeBranch(
  muscle: MuscleType,
  logs: TrainingLog[],
  extra?: { reps: number; sets: number }
): EvolutionBranch {
  let repWeighted = 0;
  let setSum = 0;
  for (const log of logs) {
    const def = EXERCISE_BY_NAME[log.exerciseName];
    if (def && def.targets.some(t => t.muscle === muscle)) {
      repWeighted += log.reps * log.sets;
      setSum += log.sets;
    }
  }
  if (extra && extra.sets > 0) {
    repWeighted += extra.reps * extra.sets;
    setSum += extra.sets;
  }
  if (setSum === 0) return 'balanced'; // データ不足はバランス型
  const avgReps = repWeighted / setSum;
  if (avgReps <= 7) return 'power';
  if (avgReps >= 13) return 'endurance';
  return 'balanced';
}

// 表示用: 第3形態なら保存済みの型を優先し、無ければ履歴から算出する（旧セーブ互換）。
// 第3形態未満は分岐なし（undefined）。
function resolveBranch(
  mStats: MuscleStats,
  muscle: MuscleType,
  logs: TrainingLog[]
): EvolutionBranch | undefined {
  if (getEvolutionPhase(mStats.level) < 3) return undefined;
  return mStats.evolutionBranch ?? computeBranch(muscle, logs);
}

// 各筋肉が属する部位グループのID（バランス集計用）
const MUSCLE_TO_GROUP: Record<MuscleType, string> = (() => {
  const map = {} as Record<MuscleType, string>;
  MUSCLE_GROUPS.forEach(g => g.muscles.forEach(m => { map[m] = g.id; }));
  return map;
})();

// レーダーチャート用の短いグループ名
const GROUP_SHORT: Record<string, string> = {
  chest: '胸部',
  back: '背部',
  shoulder_arms: '肩・腕',
  abs_core: '腹・体幹',
  legs_glutes: '脚・尻',
};

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

// 総挙上重量を身近なものに例える（数字を眺めて楽しくするための演出）
function formatVolumeComparison(kg: number): string {
  const tiers = [
    { unit: 150000, emoji: '🐋', name: 'シロナガスクジラ', suffix: '頭' },
    { unit: 6000, emoji: '🐘', name: 'アフリカ象', suffix: '頭' },
    { unit: 1500, emoji: '🚗', name: '乗用車', suffix: '台' },
    { unit: 130, emoji: '🐼', name: 'ジャイアントパンダ', suffix: '頭' },
    { unit: 10, emoji: '🍚', name: '米袋(10kg)', suffix: '袋' },
  ];
  const tier = tiers.find(t => kg >= t.unit) ?? tiers[tiers.length - 1];
  const n = kg / tier.unit;
  const nStr = n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1);
  return `${tier.emoji} ${tier.name} 約${nStr}${tier.suffix}分！`;
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
  const branchInfo = detail.evolutionBranch ? BRANCH_INFO[detail.evolutionBranch] : null;

  return (
    <div className="result-row" style={{ display: 'flex', alignItems: 'center' }}>
      <img
        src={getSpriteSrc(detail.muscle, phase, detail.evolutionBranch)}
        onError={e => handleSpriteError(e, detail.muscle)}
        alt={MUSCLE_NAMES[detail.muscle]}
        style={{ width: '50px', height: '50px', objectFit: 'contain', marginRight: '15px', filter: branchInfo ? `drop-shadow(0 0 6px ${branchInfo.color})` : 'none' }}
      />
      <div style={{ flex: 1 }}>
        <div className="result-muscle-name">
          {MUSCLE_NAMES[detail.muscle]}
          {branchInfo && <span style={{ color: branchInfo.color, marginLeft: '5px', fontSize: '0.85rem', fontWeight: 'bold' }}>{branchInfo.emoji}{branchInfo.label}</span>}
          <span className="result-exp-text">
            Lv.{currentLevel} <span style={{ fontWeight: 'bold', color: '#39ff14' }}>(+{detail.gainedExp} EXP)</span>
            {detail.isOverworked && <span style={{ color: 'orange', marginLeft: '4px', fontSize: '0.8rem' }}>(疲労半減)</span>}
            {detail.isSuperComp && <span style={{ color: '#39ff14', marginLeft: '4px', fontSize: '0.8rem' }}>(⚡超回復 x{SUPERCOMP_BONUS})</span>}
            {detail.isPoorCondition && <span style={{ color: '#ff9f1c', marginLeft: '4px', fontSize: '0.8rem' }}>({detail.conditionLabel} x{detail.conditionMultiplier})</span>}
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
      if (parsed.arms && (!parsed.biceps || !parsed.triceps)) {
        const armsData = parsed.arms;
        parsed.biceps = parsed.biceps || { ...armsData };
        parsed.triceps = parsed.triceps || { ...armsData };
        delete parsed.arms;
      }
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

  const [streak, setStreak] = useState<StreakData>(() => {
    const saved = localStorage.getItem('trainingStreak');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { current: parsed.current ?? 0, best: parsed.best ?? 0, lastDate: parsed.lastDate ?? '' };
    }
    return { current: 0, best: 0, lastDate: '' };
  });

  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(EXERCISES[0].id);
  const [weight, setWeight] = useState<number | ''>('');
  const [reps, setReps] = useState<number | ''>('');
  const [sets, setSets] = useState<number | ''>('');

  const [evolutionAlerts, setEvolutionAlerts] = useState<{ muscle: MuscleType, phase: number, branch?: EvolutionBranch }[]>([]);
  const [bestPumpAlert, setBestPumpAlert] = useState<MuscleType | null>(null);
  const [overworkAlerts, setOverworkAlerts] = useState<MuscleType[]>([]);
  const [detrainAlert, setDetrainAlert] = useState<string[]>([]);
  const [conditionDropAlert, setConditionDropAlert] = useState<string[]>([]);

  // 時間経過に応じて表示を更新するためのティック（プロテインボタンの出現判定など）
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ヘルパー: 指定した筋肉が「休息中」かどうかを判定する
  // 今日トレーニングした筋肉は、その日のうちはペナルティ回避のため休息中とはみなさない
  const checkIsRecovering = (muscle: MuscleType, currentStats: AppState) => {
    const mStats = currentStats[muscle];
    const lastTrainedAt = mStats?.lastTrainedAt || 0;
    if (lastTrainedAt === 0) return false;

    const requiredRecoveryMs = MUSCLE_RECOVERY_HOURS[muscle] * 60 * 60 * 1000;
    const timeSinceLastTraining = Date.now() - lastTrainedAt;

    // 前回のトレーニングが今日なら、ペナルティなし
    const isTrainedToday = new Date(lastTrainedAt).toDateString() === new Date().toDateString();

    return timeSinceLastTraining < requiredRecoveryMs && !isTrainedToday;
  };

  // ヘルパー: 指定した筋肉が「超回復ピーク」（適時トレのボーナス対象）かどうかを判定する。
  // 回復完了後～サボり圏に入る前（回復時間×GRACE まで）に鍛えるとボーナス。
  const checkIsSuperComp = (muscle: MuscleType, currentStats: AppState) => {
    const lastTrainedAt = currentStats[muscle]?.lastTrainedAt || 0;
    if (lastTrainedAt === 0) return false;
    const requiredRecoveryMs = MUSCLE_RECOVERY_HOURS[muscle] * 60 * 60 * 1000;
    const elapsed = Date.now() - lastTrainedAt;
    return elapsed >= requiredRecoveryMs && elapsed <= requiredRecoveryMs * CONDITION_SABORI_GRACE_FACTOR;
  };

  const [selectedMuscleInfo, setSelectedMuscleInfo] = useState<MuscleType | null>(null);
  const [recordSuccess, setRecordSuccess] = useState(false);
  const [recordResult, setRecordResult] = useState<{ details: RecordResultDetail[], isBestPump: boolean, streakCount: number, nextStreakMilestone: { days: number; title: string } | null } | null>(null);
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [achievementAlert, setAchievementAlert] = useState<Achievement | null>(null);

  useEffect(() => {
    const now = Date.now();
    let hasChanges = false;
    const newStats = { ...stats };
    const droppedMuscles: string[] = [];
    const conditionDrops: string[] = [];

    (Object.keys(newStats) as MuscleType[]).forEach(muscle => {
      const mStat = newStats[muscle];
      if (mStat.lastTrainedAt && (now - mStat.lastTrainedAt > DETRAIN_THRESHOLD_MS)) {
        if (mStat.exp > 0) {
          mStat.exp = Math.floor(mStat.exp / 2);
          hasChanges = true;
          droppedMuscles.push(MUSCLE_NAMES[muscle]);
        }
        mStat.lastTrainedAt = now;
      }

      // サボりによるコンディション減衰：回復時間×GRACE を過ぎた放置分を精算する。
      // conditionUpdatedAt を進めることで次回起動時に二重計上しない。
      if (mStat.lastTrainedAt) {
        const recoveryMs = MUSCLE_RECOVERY_HOURS[muscle] * 60 * 60 * 1000;
        const graceEnd = mStat.lastTrainedAt + recoveryMs * CONDITION_SABORI_GRACE_FACTOR;
        const anchor = Math.max(mStat.conditionUpdatedAt ?? 0, graceEnd);
        if (now > anchor) {
          const neglectedDays = (now - anchor) / (24 * 60 * 60 * 1000);
          const lost = Math.floor(neglectedDays * CONDITION_SABORI_DECAY_PER_DAY);
          if (lost > 0) {
            const cur = mStat.condition ?? MAX_CONDITION;
            const next = Math.max(0, cur - lost);
            if (next !== cur) {
              mStat.condition = next;
              conditionDrops.push(MUSCLE_NAMES[muscle]);
            }
            mStat.conditionUpdatedAt = now;
            hasChanges = true;
          }
        }
      }
    });

    if (hasChanges) {
      setStats(newStats);
      if (droppedMuscles.length > 0) setDetrainAlert(droppedMuscles);
      if (conditionDrops.length > 0) setConditionDropAlert(conditionDrops);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    localStorage.setItem('trainingStreak', JSON.stringify(streak));
  }, [streak]);

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

    // 連続トレーニング日数（ストリーク）を更新する。報酬はEXPではなく称号なので、
    // ここで baseGainedExp には手を加えない（部位EXPの負荷連動思想を守る）。
    const todayStr = new Date().toDateString();
    let nextStreak: StreakData = streak;
    if (streak.lastDate !== todayStr) {
      const gap = streak.lastDate ? dayDiff(streak.lastDate, todayStr) : Infinity;
      const current = gap === 1 ? streak.current + 1 : 1; // 昨日から継続なら+1、それ以外は途切れて1から
      nextStreak = { current, best: Math.max(streak.best, current), lastDate: todayStr };
    }

    const details: RecordResultDetail[] = [];
    const newEvolutions: { muscle: MuscleType, phase: number, branch?: EvolutionBranch }[] = [];
    const newOverworkedMuscles: MuscleType[] = [];

    // レベルアップ・進化・実績判定はセット記録の副作用（details/newEvolutions 等）に依存するため、
    // 遅延実行される setStats の更新関数の中ではなく、ここで同期的に計算してから state に反映する。
    const nextStats: AppState = { ...stats };
    {
      selectedExercise.targets.forEach(target => {
        const muscle = target.muscle;
        const current = nextStats[muscle];
        const oldExp = current.exp;
        const oldLevel = current.level;

        // 超回復（ペナルティ）とプロテインボーナスの判定
        let expToAdd = Math.max(1, Math.floor(baseGainedExp * target.expRatio));
        const isRecovering = checkIsRecovering(muscle, stats);
        const isSuperComp = checkIsSuperComp(muscle, stats);

        let isOverworked = false;
        let isProteinBonus = false;

        if (isRecovering) {
          expToAdd = Math.max(1, Math.floor(expToAdd * 0.5));
          isOverworked = true;
          if (!newOverworkedMuscles.includes(muscle)) {
            newOverworkedMuscles.push(muscle);
          }
        } else if (current.proteinBonusMultiplier) {
          expToAdd = Math.max(1, Math.floor(expToAdd * current.proteinBonusMultiplier));
          isProteinBonus = true;
        } else if (current.hasProteinBonus) {
          // 下位互換性
          expToAdd = Math.max(1, Math.floor(expToAdd * 1.3));
          isProteinBonus = true;
        }

        // 超回復ピーク（適時トレ）ボーナス。回復完了後～サボり圏に入る前に鍛えると加算。
        // 部位ごとの負荷・回復タイミングに連動した報酬なので、過剰トレ/プロテインとは別軸で乗算する。
        if (isSuperComp) {
          expToAdd = Math.max(1, Math.floor(expToAdd * SUPERCOMP_BONUS));
        }

        // コンディションによるペナルティ。過去の育成ミス（過剰トレ・サボり）で調子が
        // 落ちていると、今回の獲得EXPが減る（マイナスにはならない）。今回の記録前の
        // コンディションで判定する＝「ミスのツケを次回に払う」仕組み。
        const currentCondition = current.condition ?? MAX_CONDITION;
        const conditionTier = getConditionTier(currentCondition);
        let isPoorCondition = false;
        if (conditionTier.multiplier < 1) {
          expToAdd = Math.max(1, Math.floor(expToAdd * conditionTier.multiplier));
          isPoorCondition = true;
        }

        // 次回に向けてコンディションを更新する。過剰トレは低下、適切なトレは回復。
        const nextCondition = isRecovering
          ? Math.max(0, currentCondition - CONDITION_OVERWORK_PENALTY)
          : Math.min(MAX_CONDITION, currentCondition + CONDITION_TRAIN_RECOVERY);

        let newExp = current.exp + expToAdd;
        let newLevel = current.level;
        let didLevelUp = false;

        while (newExp >= getRequiredExp(newLevel)) {
          newExp -= getRequiredExp(newLevel);
          newLevel++;
          didLevelUp = true;
        }

        let evolutionPhase: number | undefined;
        // 第3形態到達時に確定する分岐進化の型。既に確定済みなら維持する。
        let branch: EvolutionBranch | undefined = current.evolutionBranch;

        if (didLevelUp) {
          const oldPhase = getEvolutionPhase(current.level);
          const newPhase = getEvolutionPhase(newLevel);

          if (newPhase > oldPhase) {
            evolutionPhase = newPhase;
            // 第3形態への進化のときだけ、トレーニング傾向から型を一度だけ確定
            if (newPhase === 3 && !branch) {
              branch = computeBranch(muscle, trainingLogs, { reps: r, sets: s });
            }
            newEvolutions.push({ muscle, phase: newPhase, branch: newPhase === 3 ? branch : undefined });
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
          isSuperComp,
          isPoorCondition,
          conditionMultiplier: conditionTier.multiplier,
          conditionLabel: isPoorCondition ? conditionTier.label : undefined,
          evolutionPhase,
          evolutionBranch: evolutionPhase === 3 ? branch : undefined
        });

        nextStats[muscle] = {
          ...current,
          level: newLevel,
          exp: newExp,
          lastTrainedAt: Date.now(),
          hasProteinBonus: false, // プロテイン効果を消費
          proteinBonusMultiplier: undefined,
          evolutionBranch: branch,
          condition: nextCondition,
          conditionUpdatedAt: Date.now()
        };
      });
    }
    setStats(nextStats);

    if (nextStreak !== streak) {
      setStreak(nextStreak);
    }

    if (newOverworkedMuscles.length > 0) {
      setOverworkAlerts(newOverworkedMuscles);
    }

    // 実績判定は反映後の nextStats を使う
    const nextStatsToUse = nextStats;

    setRecordResult({ details, isBestPump, streakCount: nextStreak.current, nextStreakMilestone: getNextStreakMilestone(nextStreak) });

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
        if (!finalUnlocked.includes(ach.id) && ach.check(nextStatsToUse, updatedLogs, nextStreak)) {
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
    const colors = ['#161b22', '#053b16', '#0b752b', '#1dd354', '#39ff14'];
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
    let appliedGoldenCount = 0;
    let appliedNormalCount = 0;

    setStats(prev => {
      const nextStats = { ...prev };
      Object.keys(nextStats).forEach(key => {
        const muscle = key as MuscleType;
        const current = nextStats[muscle];
        
        const timeSinceLastTraining = Date.now() - (current.lastTrainedAt || 0);
        const fortyMinutesMs = 40 * 60 * 1000;
        const twoHoursMs = 2 * 60 * 60 * 1000;

        // まだトレーニングしたことがない部位は無効
        if ((current.lastTrainedAt || 0) === 0) return;

        // ボーナス倍率の判定
        let newMultiplier = current.proteinBonusMultiplier || (current.hasProteinBonus ? 1.3 : 1.0);
        let updated = false;

        if (timeSinceLastTraining <= fortyMinutesMs) {
          if (newMultiplier < 1.5) {
            newMultiplier = 1.5;
            appliedGoldenCount++;
            updated = true;
          }
        } else if (timeSinceLastTraining <= twoHoursMs) {
          if (newMultiplier < 1.3) {
            newMultiplier = 1.3;
            appliedNormalCount++;
            updated = true;
          }
        }

        if (updated) {
          nextStats[muscle] = {
            ...current,
            hasProteinBonus: false, // 過去のフラグをクリア
            proteinBonusMultiplier: newMultiplier
          };
        }
      });
      return nextStats;
    });

    if (appliedGoldenCount > 0 || appliedNormalCount > 0) {
      let msg = "";
      if (appliedGoldenCount > 0) msg += `${appliedGoldenCount}箇所の筋肉にゴールデンタイムボーナス（次回EXP1.5倍）が適用されました！\n`;
      if (appliedNormalCount > 0) msg += `${appliedNormalCount}箇所の筋肉に通常プロテインボーナス（次回EXP1.3倍）が適用されました！`;
      alert(msg.trim());
    } else {
      alert(`筋トレ後2時間以内の筋肉がないか、すでに全ての対象部位により高いボーナスが適用されています。\n※プロテイン効果は筋トレ後2時間以内のみ有効です！`);
    }
  };

  // プロテインボーナスを適用できる部位が1つでもあるか（handleDrinkProtein と同じ条件）
  const hasProteinTarget = useMemo(() => {
    const fortyMinutesMs = 40 * 60 * 1000;
    const twoHoursMs = 2 * 60 * 60 * 1000;
    return (Object.keys(stats) as MuscleType[]).some(muscle => {
      const current = stats[muscle];
      if ((current.lastTrainedAt || 0) === 0) return false;

      const timeSinceLastTraining = now - (current.lastTrainedAt || 0);
      const currentMultiplier = current.proteinBonusMultiplier || (current.hasProteinBonus ? 1.3 : 1.0);

      if (timeSinceLastTraining <= fortyMinutesMs) return currentMultiplier < 1.5;
      if (timeSinceLastTraining <= twoHoursMs) return currentMultiplier < 1.3;
      return false;
    });
  }, [stats, now]);

  const recommendedExercises = useMemo(() => {
    const safeExercises = EXERCISES.filter(ex => {
      return ex.targets.every(target => !checkIsRecovering(target.muscle, stats));
    });
    // Shuffle safely inside useMemo so it only changes when stats change
    return safeExercises.sort(() => 0.5 - Math.random()).slice(0, 3);
  }, [stats]);

  // 履歴タブのダッシュボード用の集計データ
  const analytics = useMemo(() => {
    const logs = trainingLogs;

    const totalSets = logs.reduce((a, l) => a + l.sets, 0);
    const totalReps = logs.reduce((a, l) => a + l.reps * l.sets, 0);
    const totalVolume = logs.reduce((a, l) => a + l.weight * l.reps * l.sets, 0);
    const totalExp = logs.reduce((a, l) => a + l.gainedExp, 0);

    const trainedDates = new Set(logs.map(l => new Date(l.timestamp).toDateString()));
    const totalDays = trainedDates.size;

    // 連続記録日数（今日を含む。今日未記録なら昨日を起点に遡ってカウント）
    const dayMs = 24 * 60 * 60 * 1000;
    let streak = 0;
    let cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (!trainedDates.has(cursor.toDateString())) {
      cursor = new Date(cursor.getTime() - dayMs);
    }
    while (trainedDates.has(cursor.toDateString())) {
      streak++;
      cursor = new Date(cursor.getTime() - dayMs);
    }

    const totalLevel = (Object.keys(stats) as MuscleType[]).reduce((a, m) => a + stats[m].level, 0);

    // 部位グループ別バランス（セット数 × EXP比率を集計）
    const groupScore: Record<string, number> = {};
    MUSCLE_GROUPS.forEach(g => { groupScore[g.id] = 0; });
    logs.forEach(l => {
      const ex = EXERCISE_BY_NAME[l.exerciseName];
      if (!ex) return;
      ex.targets.forEach(t => {
        const gid = MUSCLE_TO_GROUP[t.muscle];
        if (gid) groupScore[gid] += l.sets * t.expRatio;
      });
    });
    const groupMax = Math.max(1, ...Object.values(groupScore));

    // 種目別ランキング（累計セット数の多い順トップ5）
    const exAgg: Record<string, { name: string; sets: number; count: number }> = {};
    logs.forEach(l => {
      if (!exAgg[l.exerciseName]) exAgg[l.exerciseName] = { name: l.exerciseName, sets: 0, count: 0 };
      exAgg[l.exerciseName].sets += l.sets;
      exAgg[l.exerciseName].count += 1;
    });
    const topExercises = Object.values(exAgg).sort((a, b) => b.sets - a.sets).slice(0, 5);
    const topExerciseMax = Math.max(1, ...topExercises.map(e => e.sets));

    // 曜日別トレーニング回数（月〜日）
    const weekdayCount = [0, 0, 0, 0, 0, 0, 0];
    logs.forEach(l => {
      const d = new Date(l.timestamp).getDay();
      weekdayCount[d === 0 ? 6 : d - 1] += 1;
    });
    const weekdayMax = Math.max(1, ...weekdayCount);
    const favWeekdayIdx = logs.length > 0 ? weekdayCount.indexOf(Math.max(...weekdayCount)) : -1;

    return {
      totalSets, totalReps, totalVolume, totalExp, totalDays, streak, totalLevel,
      groupScore, groupMax, topExercises, topExerciseMax,
      weekdayCount, weekdayMax, favWeekdayIdx,
    };
  }, [trainingLogs, stats]);

  // 分析ダッシュボードの描画
  const renderDashboard = () => {
    const a = analytics;

    // --- 部位バランス レーダーチャート（五角形）---
    const size = 210;
    const cx = size / 2;
    const cy = size / 2;
    const R = 68;
    const groupsInOrder = MUSCLE_GROUPS;
    const n = groupsInOrder.length;
    const angleFor = (i: number) => (-90 + i * (360 / n)) * Math.PI / 180;
    const pointAt = (i: number, r: number): [number, number] => [
      cx + r * Math.cos(angleFor(i)),
      cy + r * Math.sin(angleFor(i)),
    ];
    const ringLevels = [0.25, 0.5, 0.75, 1];
    const ringPoints = (frac: number) =>
      groupsInOrder.map((_, i) => pointAt(i, R * frac).join(',')).join(' ');
    const dataPoints = groupsInOrder
      .map((g, i) => pointAt(i, R * (a.groupScore[g.id] / a.groupMax)).join(','))
      .join(' ');

    const statTiles = [
      { icon: '📅', label: 'トレ日数', value: `${a.totalDays}`, unit: '日', color: '#00ffff' },
      { icon: '🔥', label: '連続記録', value: `${a.streak}`, unit: '日', color: '#ff8c00' },
      { icon: '💪', label: '総セット', value: `${a.totalSets.toLocaleString()}`, unit: 'set', color: '#39ff14' },
      { icon: '🔁', label: '総レップ', value: `${a.totalReps.toLocaleString()}`, unit: '回', color: '#ff00ff' },
      { icon: '⭐', label: '累計EXP', value: `${a.totalExp.toLocaleString()}`, unit: '', color: '#ffea00' },
      { icon: '📈', label: '総合Lv', value: `${a.totalLevel}`, unit: '', color: '#00bfff' },
    ];

    const subHeading = (icon: string, text: string) => (
      <h3 style={{ fontSize: '1rem', margin: '0 0 0.8rem 0', color: 'var(--text-accent)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>{icon}</span> {text}
      </h3>
    );

    return (
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
          📊 トレーニング分析
        </h3>

        {/* サマリー統計タイル */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem', marginBottom: '1.2rem' }}>
          {statTiles.map(t => (
            <div key={t.label} style={{
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px',
              padding: '0.7rem 0.4rem',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '1.1rem', lineHeight: 1 }}>{t.icon}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: '4px 0 2px' }}>{t.label}</div>
              <div style={{ fontWeight: 'bold', color: t.color, textShadow: `0 0 8px ${t.color}66` }}>
                <span style={{ fontSize: '1.25rem' }}>{t.value}</span>
                {t.unit && <span style={{ fontSize: '0.65rem', marginLeft: '2px' }}>{t.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* 総挙上重量ヒーローカード */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,0,127,0.12), rgba(255,140,0,0.12))',
          border: '1px solid rgba(255,140,0,0.4)',
          borderRadius: '12px',
          padding: '1.2rem',
          marginBottom: '1.2rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>🏋️ これまでの総挙上重量</div>
          <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: '#ff8c00', textShadow: '0 0 15px rgba(255,140,0,0.5)', lineHeight: 1.1 }}>
            {Math.round(a.totalVolume).toLocaleString()}<span style={{ fontSize: '1rem', marginLeft: '4px' }}>kg</span>
          </div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '0.5rem' }}>
            {formatVolumeComparison(a.totalVolume)}
          </div>
        </div>

        {/* 部位バランス レーダーチャート */}
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.2rem', marginBottom: '1.2rem' }}>
          {subHeading('🕸️', '部位バランス')}
          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: '-0.5rem 0 0.8rem' }}>
            まんべんなく鍛えて五角形を大きくしよう！
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: '100%' }}>
              {/* グリッド（同心五角形） */}
              {ringLevels.map(frac => (
                <polygon key={frac} points={ringPoints(frac)} fill="none" stroke="rgba(0,255,255,0.15)" strokeWidth={1} />
              ))}
              {/* 軸線 */}
              {groupsInOrder.map((_, i) => {
                const [x, y] = pointAt(i, R);
                return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(0,255,255,0.15)" strokeWidth={1} />;
              })}
              {/* データポリゴン */}
              <polygon points={dataPoints} fill="rgba(255,0,255,0.25)" stroke="#ff00ff" strokeWidth={2} style={{ filter: 'drop-shadow(0 0 6px rgba(255,0,255,0.6))' }} />
              {/* 頂点マーカー */}
              {groupsInOrder.map((g, i) => {
                const [x, y] = pointAt(i, R * (a.groupScore[g.id] / a.groupMax));
                return <circle key={g.id} cx={x} cy={y} r={3} fill="#00ffff" />;
              })}
              {/* ラベル */}
              {groupsInOrder.map((g, i) => {
                const [x, y] = pointAt(i, R + 20);
                return (
                  <text key={g.id} x={x} y={y} fill="var(--text-secondary)" fontSize="10" textAnchor="middle" dominantBaseline="middle">
                    {GROUP_SHORT[g.id]}
                  </text>
                );
              })}
            </svg>
          </div>
        </div>

        {/* よく使う種目 TOP5 */}
        {a.topExercises.length > 0 && (
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.2rem', marginBottom: '1.2rem' }}>
            {subHeading('🏆', 'よく鍛えた種目 TOP5')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {a.topExercises.map((ex, i) => {
                const pct = (ex.sets / a.topExerciseMax) * 100;
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <div key={ex.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '3px' }}>
                      <span>{medals[i] || `${i + 1}.`} {ex.name}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{ex.sets}set / {ex.count}回</span>
                    </div>
                    <div style={{ width: '100%', height: '10px', background: 'rgba(255,255,255,0.08)', borderRadius: '5px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #00ffff, #ff00ff)', borderRadius: '5px', transition: 'width 0.6s ease-out' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 曜日別トレーニング傾向 */}
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.2rem' }}>
          {subHeading('📆', '曜日別トレーニング')}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '4px', height: '90px' }}>
            {a.weekdayCount.map((c, i) => {
              const pct = (c / a.weekdayMax) * 100;
              const isFav = i === a.favWeekdayIdx && c > 0;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                    <div
                      data-tooltip-id="calendar-tooltip"
                      data-tooltip-content={`${WEEKDAY_LABELS[i]}曜日: ${c}回`}
                      style={{
                        width: '100%',
                        height: `${Math.max(pct, c > 0 ? 8 : 2)}%`,
                        background: isFav
                          ? 'linear-gradient(180deg, #ffea00, #ff8c00)'
                          : 'linear-gradient(180deg, #00ffff, #0088ff)',
                        borderRadius: '4px 4px 0 0',
                        opacity: c > 0 ? 1 : 0.25,
                        transition: 'height 0.6s ease-out',
                        boxShadow: isFav ? '0 0 10px rgba(255,234,0,0.6)' : 'none',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '0.7rem', color: isFav ? '#ffea00' : 'var(--text-secondary)', marginTop: '4px', fontWeight: isFav ? 'bold' : 'normal' }}>
                    {WEEKDAY_LABELS[i]}
                  </div>
                </div>
              );
            })}
          </div>
          {a.favWeekdayIdx >= 0 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '0.8rem' }}>
              あなたが一番燃える曜日は <span style={{ color: '#ffea00', fontWeight: 'bold' }}>{WEEKDAY_LABELS[a.favWeekdayIdx]}曜日</span>！
            </p>
          )}
        </div>
        <Tooltip id="calendar-tooltip" />
      </div>
    );
  };

  // キャラクター図鑑の描画：全筋肉モンスターの進化系統（第1〜第3形態）を一覧表示する。
  // 未発見の形態はシルエット表示。発見状況は現在のレベルから導出する（このアプリではレベルが
  // 下がることはないため、現在レベル＝到達済みの最大フェーズとみなせる）。
  const renderEncyclopedia = () => {
    const allMuscles = MUSCLE_GROUPS.flatMap(g => g.muscles);
    const totalForms = allMuscles.length * 3;
    const discoveredForms = allMuscles.reduce((acc, m) => {
      const lv = stats[m].level;
      return acc + 1 + (lv >= 5 ? 1 : 0) + (lv >= 10 ? 1 : 0);
    }, 0);
    const completionPct = Math.round((discoveredForms / totalForms) * 100);
    const isComplete = discoveredForms === totalForms;

    return (
      <div className="glass-panel" style={{ marginTop: '0' }}>
        <h2 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>📚 モンスター図鑑</h2>
        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.2rem' }}>
          筋肉を育てて全ての進化形態をコンプリートしよう！
        </p>

        {/* コンプリート進捗 */}
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.2rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>ずかん達成度</span>
            <span style={{ fontWeight: 'bold', color: isComplete ? '#ffea00' : '#00ffff', textShadow: isComplete ? '0 0 10px rgba(255,234,0,0.6)' : 'none' }}>
              <span style={{ fontSize: '1.5rem' }}>{discoveredForms}</span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}> / {totalForms} 種</span>
            </span>
          </div>
          <div style={{ width: '100%', height: '12px', background: 'rgba(255,255,255,0.08)', borderRadius: '6px', overflow: 'hidden' }}>
            <div style={{
              width: `${completionPct}%`, height: '100%', borderRadius: '6px',
              background: isComplete ? 'linear-gradient(90deg, #ffea00, #ff8c00)' : 'linear-gradient(90deg, #00ffff, #ff00ff)',
              transition: 'width 0.6s ease-out',
              boxShadow: isComplete ? '0 0 10px rgba(255,234,0,0.6)' : 'none',
            }} />
          </div>
          <p style={{ textAlign: 'center', fontSize: '0.8rem', marginTop: '0.6rem', color: isComplete ? '#ffea00' : 'var(--text-secondary)', fontWeight: isComplete ? 'bold' : 'normal' }}>
            {isComplete ? '🎉 図鑑コンプリート！全ての筋肉が完全体だ！' : `達成率 ${completionPct}%`}
          </p>
        </div>

        {/* 部位グループごとの進化系統リスト */}
        {MUSCLE_GROUPS.map(group => (
          <div key={group.id} style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.4rem' }}>
              {group.title}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {group.muscles.map(muscle => {
                const mStats = stats[muscle];
                const level = mStats.level;
                const branch = resolveBranch(mStats, muscle, trainingLogs);
                const discoveredCount = 1 + (level >= 5 ? 1 : 0) + (level >= 10 ? 1 : 0);

                return (
                  <div
                    key={muscle}
                    className="glass-panel"
                    onClick={() => setSelectedMuscleInfo(muscle)}
                    style={{ padding: '0.8rem', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--text-accent)' }}>{MUSCLE_NAMES[muscle]}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--border-highlight)' }}>Lv.{level}</span>
                      </div>
                      <span style={{ fontSize: '0.7rem', color: discoveredCount === 3 ? '#ffea00' : 'var(--text-secondary)', fontWeight: discoveredCount === 3 ? 'bold' : 'normal' }}>
                        {discoveredCount === 3 ? '★ ' : ''}{discoveredCount}/3
                      </span>
                    </div>

                    {/* 進化系統（第1→第2→第3形態） */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      {([1, 2, 3] as const).map((phase, idx) => {
                        const info = PHASE_INFO[phase];
                        const discovered = level >= info.unlockLevel;
                        const formBranch = phase === 3 && discovered ? branch : undefined;
                        const branchInfo = formBranch ? BRANCH_INFO[formBranch] : null;

                        return (
                          <div key={phase} style={{ display: 'contents' }}>
                            {idx > 0 && (
                              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', opacity: 0.5, padding: '0 2px' }}>▶</span>
                            )}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
                              <div style={{ height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', width: '100%' }}>
                                <img
                                  src={getSpriteSrc(muscle, phase, formBranch)}
                                  onError={e => handleSpriteError(e, muscle)}
                                  alt={discovered ? `${MUSCLE_NAMES[muscle]} ${info.label}` : '未発見'}
                                  style={{
                                    maxHeight: '100%', maxWidth: '100%', objectFit: 'contain',
                                    filter: discovered
                                      ? (branchInfo ? `drop-shadow(0 0 5px ${branchInfo.color})` : 'none')
                                      : 'brightness(0) drop-shadow(0 0 1px rgba(255,255,255,0.45))',
                                    opacity: discovered ? 1 : 0.55,
                                  }}
                                />
                                {!discovered && (
                                  <span style={{ position: 'absolute', fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>？</span>
                                )}
                                {branchInfo && (
                                  <span style={{ position: 'absolute', bottom: '-2px', right: '4px', fontSize: '0.8rem', filter: `drop-shadow(0 0 2px ${branchInfo.color})` }}>
                                    {branchInfo.emoji}
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: '0.6rem', color: discovered ? 'var(--text-primary)' : 'var(--text-secondary)', marginTop: '2px', whiteSpace: 'nowrap' }}>
                                {info.label}
                              </span>
                              <span style={{ fontSize: '0.55rem', color: branchInfo ? branchInfo.color : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                {discovered ? (branchInfo ? branchInfo.label : info.stage) : `Lv.${info.unlockLevel}で解放`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
    <div className="main-content">
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        {selectedTitle && (
          <div style={{ color: '#ffea00', fontWeight: 'bold', fontSize: '1.2rem', marginBottom: '0.5rem', animation: 'float 3s ease-in-out infinite' }}>
            【{selectedTitle}】
          </div>
        )}
        <h1 style={{ color: 'var(--text-primary)', fontSize: '2.5rem', margin: '0' }}>マッスル<br />モンスターズ</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>筋トレで筋肉を育てよう！</p>
      </div>



      {/* --- タブコンテンツ：キャラクター --- */}
      {activeTab === 'characters' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

          {/* 連続トレーニング日数（ストリーク）。報酬はEXPではなく称号なので、次に狙える称号を示す。 */}
          {(() => {
            const effStreak = getEffectiveStreak(streak, now);
            const nextMilestone = getNextStreakMilestone(streak);
            return (
              <div className="glass-panel" style={{ width: '100%', marginBottom: '1rem', textAlign: 'center', borderColor: effStreak > 0 ? '#ff6b35' : undefined, background: effStreak > 0 ? 'rgba(255, 107, 53, 0.08)' : undefined }}>
                {effStreak > 0 ? (
                  <>
                    <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#ff6b35' }}>
                      🔥 {effStreak}日連続トレ中！
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.4rem 0 0' }}>
                      {nextMilestone
                        ? `あと${nextMilestone.days - effStreak}日で称号「${nextMilestone.title}」！`
                        : '全ての連続称号を達成！継続をキープしよう'}
                      {streak.best > 0 && <><br />最高記録：{streak.best}日</>}
                    </p>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                      🔥 連続トレ記録：なし
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.4rem 0 0' }}>
                      毎日どこかを鍛えて連続記録を伸ばそう（称号がもらえる！）{streak.best > 0 && ` 最高記録：${streak.best}日`}
                    </p>
                  </>
                )}
              </div>
            );
          })()}

          {conditionDropAlert.length > 0 && (
            <div className="glass-panel" style={{ borderColor: '#ff9f1c', backgroundColor: 'rgba(255, 159, 28, 0.1)', textAlign: 'center', marginBottom: '1rem', width: '100%' }}>
              <h3 style={{ color: '#ff9f1c' }}>😓 コンディション低下</h3>
              <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>トレーニングをサボったため、筋肉の調子が落ちました。回復するまで次回の獲得EXPが減ってしまいます…</p>
              <p style={{ fontWeight: 'bold', margin: '0.5rem 0' }}>{conditionDropAlert.join('、')}</p>
              <button onClick={() => setConditionDropAlert([])} style={{ borderColor: '#ff9f1c', color: '#ff9f1c', marginTop: '0.5rem', padding: '0.5rem 1rem' }}>確認した</button>
            </div>
          )}

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
          
          {/* プロテインボタン（適用可能な部位があるときだけ表示） */}
          {hasProteinTarget && (
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
                筋トレ後2時間以内にプロテインを飲むことで次回筋トレ時にEXPボーナスが付与されます
              </p>
            </div>
          )}

          <div style={{ width: '100%' }}>
          {MUSCLE_GROUPS.map(group => (
            <div key={group.id} style={{ marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
                {group.title}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '1rem' }}>
                {group.muscles.map(muscle => {
                  const mStats = stats[muscle];
                  const reqExp = getRequiredExp(mStats.level);
                  const progress = (mStats.exp / reqExp) * 100;
                  const isBestPump = bestPumpAlert === muscle;
                  const phase = getEvolutionPhase(mStats.level);
                  const branch = resolveBranch(mStats, muscle, trainingLogs);
                  const branchInfo = branch ? BRANCH_INFO[branch] : null;

                  const requiredRecoveryMs = MUSCLE_RECOVERY_HOURS[muscle] * 60 * 60 * 1000;
                  const timeSinceLastTraining = Date.now() - (mStats.lastTrainedAt || 0);
                  const isRecovering = checkIsRecovering(muscle, stats);
                  const isSuperCompReady = checkIsSuperComp(muscle, stats); // 超回復ピーク（今鍛えるとEXPボーナス）
                  const isTrainedToday = (mStats.lastTrainedAt || 0) > 0 && new Date(mStats.lastTrainedAt!).toDateString() === new Date().toDateString();

                  // プロテインボーナス関連の判定
                  const isProteinTarget = (mStats.lastTrainedAt || 0) > 0 && timeSinceLastTraining <= 2 * 60 * 60 * 1000 && !mStats.proteinBonusMultiplier && !mStats.hasProteinBonus;
                  const hasGoldenBonus = mStats.proteinBonusMultiplier === 1.5;
                  const hasNormalBonus = mStats.proteinBonusMultiplier === 1.3 || mStats.hasProteinBonus;

                  // コンディション（調子）：既にトレーニングしたことがある部位のみ表示対象
                  const conditionTier = getConditionTier(mStats.condition ?? MAX_CONDITION);
                  const showCondition = (mStats.lastTrainedAt || 0) > 0;

                  return (
                    <div 
                      key={muscle} 
                      className="glass-panel muscle-card"
                      onClick={() => setSelectedMuscleInfo(muscle)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', padding: '0.8rem 0.5rem', cursor: 'pointer', transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        borderColor: isTrainedToday ? '#39ff14' : undefined,
                        boxShadow: isTrainedToday ? '0 0 16px rgba(57, 255, 20, 0.35)' : undefined
                      }}
                    >
                      
                      {isBestPump && (
                        <div className="best-pump-badge" style={{ fontSize: '0.8rem', padding: '2px 6px', top: '2px' }}>
                          PUMP!<br/>x1.5
                        </div>
                      )}

                      <h3
                        data-tooltip-id="calendar-tooltip"
                        data-tooltip-content={isTrainedToday ? '本日トレーニング済み！' : undefined}
                        style={{ fontSize: '0.8rem', marginBottom: '0.2rem' }}
                      >
                        {MUSCLE_NAMES[muscle]}
                      </h3>
                      <p style={{ color: 'var(--border-highlight)', margin: '0', fontSize: '0.8rem' }}>Lv.{mStats.level}</p>
                      
                      <div style={{ height: '65px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0.5rem 0', position: 'relative', width: '100%' }}>
                        <img
                          src={getSpriteSrc(muscle, phase, branch)}
                          onError={e => handleSpriteError(e, muscle)}
                          alt={muscle}
                          className={`monster-image`}
                          style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', filter: isRecovering ? 'brightness(0.6) grayscale(0.4)' : (branchInfo ? `drop-shadow(0 0 6px ${branchInfo.color}) drop-shadow(0 0 3px ${branchInfo.color})` : 'none') }}
                        />
                        {branchInfo && (
                          <div
                            data-tooltip-id="calendar-tooltip"
                            data-tooltip-content={`分岐進化: ${branchInfo.label}`}
                            style={{ position: 'absolute', bottom: '-4px', right: '2px', fontSize: '0.85rem', lineHeight: 1, filter: `drop-shadow(0 0 2px ${branchInfo.color})`, pointerEvents: 'auto' }}
                          >
                            {branchInfo.emoji}
                          </div>
                        )}
                        {showCondition && (
                          <div
                            data-tooltip-id="calendar-tooltip"
                            data-tooltip-content={`コンディション: ${conditionTier.label}${conditionTier.multiplier < 1 ? `（次回EXP x${conditionTier.multiplier}）` : ''}`}
                            style={{ position: 'absolute', bottom: '-4px', left: '2px', fontSize: '0.9rem', lineHeight: 1, filter: `drop-shadow(0 0 2px ${conditionTier.color})`, pointerEvents: 'auto' }}
                          >
                            {conditionTier.emoji}
                          </div>
                        )}
                        {isRecovering && (
                          <div
                            data-tooltip-id="calendar-tooltip"
                            data-tooltip-content={`休息中：あと${Math.ceil((requiredRecoveryMs - timeSinceLastTraining) / (60 * 60 * 1000))}時間`}
                            style={{ position: 'absolute', top: '-5px', right: '5px', background: 'rgba(0,0,0,0.7)', padding: '2px', borderRadius: '50%', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', border: '1px solid rgba(255,255,255,0.2)' }}
                          >
                            💤
                          </div>
                        )}
                        {isSuperCompReady && !isTrainedToday && (
                          <div
                            data-tooltip-id="calendar-tooltip"
                            data-tooltip-content={`超回復ピーク！今鍛えると獲得EXP x${SUPERCOMP_BONUS}`}
                            style={{ position: 'absolute', top: '-5px', right: '5px', background: 'rgba(57, 255, 20, 0.2)', padding: '2px', borderRadius: '50%', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', border: '1px solid rgba(57, 255, 20, 0.5)', animation: 'pulse 1.5s infinite' }}
                          >
                            ⚡
                          </div>
                        )}
                        {(hasGoldenBonus || hasNormalBonus || isProteinTarget) && (
                          <div 
                            data-tooltip-id="calendar-tooltip"
                            data-tooltip-content={hasGoldenBonus ? 'ゴールデンタイムボーナス適用中！(次回のEXP1.5倍)' : hasNormalBonus ? 'プロテインボーナス適用中！(次回のEXP1.3倍)' : 'プロテインボーナス対象！(筋トレから2時間以内)'}
                            style={{ 
                              position: 'absolute', top: '-5px', left: '5px', 
                              background: hasGoldenBonus ? 'rgba(255, 234, 0, 0.2)' : 'rgba(0, 255, 255, 0.2)', 
                              padding: '2px', borderRadius: '50%', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', 
                              border: `1px solid ${hasGoldenBonus ? 'rgba(255, 234, 0, 0.5)' : 'rgba(0, 255, 255, 0.5)'}`, 
                              animation: isProteinTarget ? 'pulse 1.5s infinite' : 'float 2s ease-in-out infinite' 
                            }}
                          >
                            {hasGoldenBonus ? '✨' : '🥤'}
                          </div>
                        )}
                      </div>

                      {/* EXP バー */}
                      <div style={{ width: '100%', marginTop: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
                          <span>EXP</span>
                          <span>{mStats.exp}/{reqExp}</span>
                        </div>
                        <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg, #00ffff, #0088ff)', transition: 'width 0.5s ease-out' }} />
                        </div>
                      </div>

                      {/* 休息ゲージ */}
                      {isRecovering && (
                        <div style={{ width: '100%', marginTop: '0.5rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'orange', marginBottom: '2px' }}>
                            <span>休息中</span>
                            <span>あと{Math.ceil((requiredRecoveryMs - timeSinceLastTraining) / (60 * 60 * 1000))}時間</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${(timeSinceLastTraining / requiredRecoveryMs) * 100}%`, height: '100%', background: 'orange', transition: 'width 0.5s ease-out' }} />
                          </div>
                        </div>
                      )}

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
              {recommendedExercises.length > 0 && (
                <div style={{ background: 'rgba(57, 255, 20, 0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid #39ff14', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.9rem', color: '#39ff14', fontWeight: 'bold', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span>✨</span> おすすめトレーニング
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {recommendedExercises.map(ex => (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => setSelectedExerciseId(ex.id)}
                        style={{ 
                          padding: '0.4rem 0.8rem', 
                          fontSize: '0.85rem', 
                          background: selectedExerciseId === ex.id ? 'var(--btn-hover-bg)' : 'rgba(0,0,0,0.5)',
                          color: selectedExerciseId === ex.id ? 'var(--btn-hover-text)' : 'var(--text-primary)',
                          border: `1px solid ${selectedExerciseId === ex.id ? '#39ff14' : 'var(--border-color)'}`,
                          textTransform: 'none'
                        }}
                      >
                        {ex.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label style={{ fontSize: '1.1rem', color: 'var(--text-accent)' }}>🏋️ トレーニング種目</label>
              <select 
                value={selectedExerciseId} 
                onChange={e => setSelectedExerciseId(e.target.value)}
                style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}
              >
                {MUSCLE_GROUPS.map(group => {
                  const groupExercises = EXERCISES.filter(ex => group.muscles.includes(ex.primaryMuscle));
                  if (groupExercises.length === 0) return null;
                  return (
                    <optgroup key={group.id} label={group.title}>
                      {groupExercises.map(ex => (
                        <option key={ex.id} value={ex.id}>
                          {ex.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>

              {selectedExercise && (
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '8px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', width: '100%', textAlign: 'center', marginBottom: '4px' }}>対象のマスモン</span>
                  {selectedExercise.targets.map(target => {
                    const mStats = stats[target.muscle];
                    const phase = getEvolutionPhase(mStats.level);
                    const targetBranch = resolveBranch(mStats, target.muscle, trainingLogs);
                    const isRecovering = checkIsRecovering(target.muscle, stats);

                    return (
                      <div key={target.muscle} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                        <img
                          src={getSpriteSrc(target.muscle, phase, targetBranch)}
                          onError={e => handleSpriteError(e, target.muscle)}
                          alt={target.muscle}
                          style={{ height: '40px', objectFit: 'contain', filter: isRecovering ? 'brightness(0.6) grayscale(0.4)' : 'none' }}
                        />
                        {isRecovering && (
                          <div style={{ position: 'absolute', top: '-5px', right: '-10px', background: 'rgba(0,0,0,0.7)', padding: '1px', borderRadius: '50%', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', border: '1px solid rgba(255,255,255,0.2)' }}>
                            💤
                          </div>
                        )}
                        <span style={{ fontSize: '0.65rem', color: isRecovering ? 'orange' : '#39ff14', fontWeight: isRecovering ? 'normal' : 'bold', marginTop: '2px' }}>
                          {MUSCLE_NAMES[target.muscle]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedExercise && selectedExercise.description && (
                <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '0.8rem', borderRadius: '8px', borderLeft: '3px solid #ffea00', marginTop: '0.5rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#ffea00', marginBottom: '4px', fontWeight: 'bold' }}>💡 やり方</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {selectedExercise.description}
                  </div>
                </div>
              )}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '0.8rem', width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.9rem', textAlign: 'center' }}>重量 (kg)</label>
                {isBodyweight ? (
                  <input type="text" value={`自重(${bodyWeight})`} disabled style={{ width: '100%', boxSizing: 'border-box', backgroundColor: 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.9rem', padding: '1rem 0' }} />
                ) : (
                  <input type="number" min="0" value={weight} onChange={e => setWeight(Number(e.target.value) || '')} placeholder="0" required style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.2rem', padding: '1rem 0' }} />
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.9rem', textAlign: 'center' }}>回数/秒数</label>
                <input type="number" min="1" value={reps} onChange={e => setReps(Number(e.target.value) || '')} required style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.2rem', padding: '1rem 0' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.9rem', textAlign: 'center' }}>セット数</label>
                <input type="number" min="1" value={sets} onChange={e => setSets(Number(e.target.value) || '')} required style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.2rem', padding: '1rem 0' }} />
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
            ⚠️ 休息中（回復中）の部位を鍛えると、疲労のため獲得EXPが半減します。
          </p>
        </div>
      )}

      {/* --- タブコンテンツ：ログ --- */}
      {activeTab === 'logs' && (
        <div className="glass-panel" style={{ marginTop: '0' }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>📖 筋トレ履歴</h2>

          {/* 分析ダッシュボード（記録がある場合のみ） */}
          {trainingLogs.length > 0 && renderDashboard()}

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
        <div className="glass-panel" style={{ marginTop: '0' }}>
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

      {/* --- タブコンテンツ：図鑑 --- */}
      {activeTab === 'encyclopedia' && renderEncyclopedia()}

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
            {recordResult.streakCount >= 2 && (
              <p style={{ color: '#ff6b35', fontWeight: 'bold', marginBottom: '1rem', fontSize: '0.95rem' }}>
                🔥 {recordResult.streakCount}日連続トレ中！
                {recordResult.nextStreakMilestone && (
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 'normal', fontSize: '0.8rem' }}>
                    {' '}（あと{recordResult.nextStreakMilestone.days - recordResult.streakCount}日で称号「{recordResult.nextStreakMilestone.title}」）
                  </span>
                )}
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
      {(!recordResult && !achievementAlert && evolutionAlerts.length > 0) && (() => {
        const alert = evolutionAlerts[0];
        const branchInfo = alert.phase === 3 && alert.branch ? BRANCH_INFO[alert.branch] : null;
        return (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ textAlign: 'center', animation: 'scaleIn 0.5s ease-out' }}>
            <h1 style={{ color: branchInfo ? branchInfo.color : '#ffea00', fontSize: '3rem', marginBottom: '1rem' }}>
              {branchInfo ? '分岐進化！！' : '進化！！'}
            </h1>
            <p style={{ fontSize: '1.5rem', marginBottom: branchInfo ? '1rem' : '2rem' }}>
              {branchInfo ? (
                <>おめでとう！<br/>{MUSCLE_NAMES[alert.muscle]} は<br/>{branchInfo.emoji} <span style={{ color: branchInfo.color, fontWeight: 'bold' }}>{branchInfo.label}</span> に分岐進化した！</>
              ) : (
                <>おめでとう！<br/>{MUSCLE_NAMES[alert.muscle]} は 第{alert.phase}形態 に進化した！</>
              )}
            </p>
            <img
              src={getSpriteSrc(alert.muscle, alert.phase as 1 | 2 | 3, alert.branch)}
              onError={e => handleSpriteError(e, alert.muscle)}
              alt="Evolved Muscle"
              className="monster-image"
              style={{
                maxHeight: '250px', maxWidth: '100%', objectFit: 'contain', marginBottom: branchInfo ? '1rem' : '2rem',
                filter: branchInfo ? `drop-shadow(0 0 18px ${branchInfo.color}) drop-shadow(0 0 8px ${branchInfo.color})` : 'none'
              }}
            />
            {branchInfo && (
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.5 }}>
                {branchInfo.description}
              </p>
            )}
            {!branchInfo && <br />}
            <button onClick={closeEvolutionAlert} style={{ width: '100%', maxWidth: '200px' }}>
              {evolutionAlerts.length > 1 ? '次へ' : '閉じる'}
            </button>
          </div>
        </div>
        );
      })()}

      {/* Muscle Detail Modal Overlay */}
      {selectedMuscleInfo && (
        <div className="modal-overlay" onClick={() => setSelectedMuscleInfo(null)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ textAlign: 'left', animation: 'scaleIn 0.3s ease-out', maxWidth: '400px', width: '90%', padding: '1.5rem' }}>
            <div style={{ marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.15rem', letterSpacing: '0.05em' }}>{MUSCLE_READINGS[selectedMuscleInfo]}</span>
                  <h2 style={{ color: 'var(--text-accent)', margin: 0, fontSize: '1.4rem' }}>{MUSCLE_NAMES[selectedMuscleInfo]}</h2>
                </div>
                <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>Lv.{stats[selectedMuscleInfo].level}</span>
              </div>
            </div>

            {(() => {
              const detailBranch = resolveBranch(stats[selectedMuscleInfo], selectedMuscleInfo, trainingLogs);
              const detailBranchInfo = detailBranch ? BRANCH_INFO[detailBranch] : null;
              return (
                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                  <img
                    src={getSpriteSrc(selectedMuscleInfo, getEvolutionPhase(stats[selectedMuscleInfo].level), detailBranch)}
                    onError={e => handleSpriteError(e, selectedMuscleInfo)}
                    alt={MUSCLE_NAMES[selectedMuscleInfo]}
                    style={{ height: '120px', objectFit: 'contain', filter: detailBranchInfo ? `drop-shadow(0 0 10px ${detailBranchInfo.color}) drop-shadow(0 0 5px ${detailBranchInfo.color})` : 'none' }}
                  />
                  {detailBranchInfo && (
                    <div style={{ marginTop: '0.6rem' }}>
                      <span style={{
                        display: 'inline-block', padding: '3px 12px', borderRadius: '999px',
                        fontSize: '0.85rem', fontWeight: 'bold', color: detailBranchInfo.color,
                        border: `1px solid ${detailBranchInfo.color}`, background: 'rgba(0,0,0,0.25)'
                      }}>
                        {detailBranchInfo.emoji} {detailBranchInfo.label} に分岐進化
                      </span>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
                        {detailBranchInfo.description}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

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
                  const isTrainedToday = new Date(mStats.lastTrainedAt).toDateString() === new Date().toDateString();

                  if (elapsedMs >= requiredMs || isTrainedToday) {
                    const inPeak = !isTrainedToday && elapsedMs <= requiredMs * CONDITION_SABORI_GRACE_FACTOR;
                    return (
                      <span style={{ color: '#39ff14' }}>
                        回復完了！トレーニング可能です
                        {inPeak && <><br />⚡ 超回復ピーク！今鍛えると獲得EXP x{SUPERCOMP_BONUS}</>}
                      </span>
                    );
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
                <span>💗</span> コンディション（調子）
              </h4>
              {(() => {
                const mStats = stats[selectedMuscleInfo];
                const condition = mStats.condition ?? MAX_CONDITION;
                const tier = getConditionTier(condition);
                return (
                  <div style={{ fontSize: '0.85rem', lineHeight: '1.5', margin: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '1.1rem' }}>{tier.emoji}</span>
                      <span style={{ color: tier.color, fontWeight: 'bold' }}>{tier.label}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>（{condition}/{MAX_CONDITION}）</span>
                    </div>
                    <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden', marginBottom: '6px' }}>
                      <div style={{ width: `${condition}%`, height: '100%', background: tier.color, transition: 'width 0.5s ease-out' }} />
                    </div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {tier.multiplier < 1
                        ? `育成ミス（過剰トレ・サボり）で調子が低下中。次回の獲得EXPが x${tier.multiplier} になります。適切なトレーニングで回復します。`
                        : '好調です。過剰なトレーニングやサボりが続くと低下し、次回の獲得EXPが減ります。'}
                    </span>
                  </div>
                );
              })()}
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

            <button onClick={() => setSelectedMuscleInfo(null)} style={{ width: '100%', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>閉じる</button>
          </div>
        </div>
      )}
    </div>

    {/* Navigation Tabs - Moved outside main wrapper to prevent z-index / fixed positioning issues */}
    <div className="tab-container">
      <button className={`tab-button ${activeTab === 'characters' ? 'active' : ''}`} onClick={() => setActiveTab('characters')}>
        <span className="tab-icon">👾</span>
        <span className="tab-label">マスモン</span>
      </button>
      <button className={`tab-button ${activeTab === 'record' ? 'active' : ''}`} onClick={() => setActiveTab('record')}>
        <span className="tab-icon">🏋️</span>
        <span className="tab-label">記録</span>
      </button>
      <button className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
        <span className="tab-icon">📖</span>
        <span className="tab-label">履歴</span>
      </button>
      <button className={`tab-button ${activeTab === 'achievements' ? 'active' : ''}`} onClick={() => setActiveTab('achievements')}>
        <span className="tab-icon">🏆</span>
        <span className="tab-label">実績</span>
      </button>
      <button className={`tab-button ${activeTab === 'encyclopedia' ? 'active' : ''}`} onClick={() => setActiveTab('encyclopedia')}>
        <span className="tab-icon">📚</span>
        <span className="tab-label">図鑑</span>
      </button>
    </div>
    </>
  );
}

export default App;
