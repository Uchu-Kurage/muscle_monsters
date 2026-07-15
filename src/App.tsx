import { useState, useEffect, useMemo, useRef } from 'react';
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
  nickname?: string;          // ユーザーがキャラ（部位モンスター）に付けたニックネーム。未設定なら部位名を表示
  lastTrainedAt?: number;
  hasProteinBonus?: boolean;
  proteinBonusMultiplier?: number;
  evolutionBranch?: EvolutionBranch; // 第3形態到達時に一度だけ確定する分岐進化の型
  condition?: number;         // コンディション（調子）0-100。中立50スタート。上でボーナス/下でペナルティ
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
  isConditionBonus: boolean;     // コンディション上昇によるEXPボーナスが適用されたか
  conditionMultiplier: number;   // コンディションによる倍率（1.0=補正なし）
  conditionLabel?: string;       // 補正時の調子ラベル（例: 絶好調 / 不調）
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

// ニックネーム登録時に提示するサンプルネーム。各部位のモチーフや役割にちなんだ人名。
// 入力欄のプレースホルダー（「例：〇〇」）として薄く表示する。
const MUSCLE_NICKNAME_SAMPLES: Record<MuscleType, string> = {
  chest: 'ゴードン',              // 力強い響きの男性名。モチーフのゴリラと頼れる胸板から
  back: 'ウィルバー',            // 人類初飛行のライト兄弟の兄。背に広がる巨大な翼の象徴
  shoulder: 'パトリック',        // 「高貴な守護者」の意。肩を覆う強固な防具のイメージ
  biceps: 'ヘラクレス',          // ギリシャ神話の英雄。ヘラクレスオオカブトと最強の力こぶに
  triceps: 'フィリップ',         // 古代ギリシャ語で「馬を愛する者」。馬蹄形とペガサスに由来
  brachioradialis: 'ボブ',       // 大工ビーバーのイメージ。ハンマーを握って木を加工する
  forearm_flexors: 'ガストン',   // 仏語で「ガッシリした男」。物を握り潰すほどの前腕
  glutes: 'アトラス',            // 地球を支える巨人。人体最大のパワーを生むお尻に
  legs: 'ジャック',              // 豪州でカンガルーのオスの愛称。跳躍力抜群のキックボクサー
  hamstrings: 'ボルト',          // 人類最速のウサイン・ボルト。爆走とブレーキを制御するもも裏
  gluteus_medius: 'ジャイロ',    // 傾きを感知し骨盤を水平に保つジャイロセンサーにちなむ
  adductors: 'クララ',           // バレエ『くるみ割り人形』のヒロイン。内ももを使う美しさから
  abs: 'アーノルド',             // ボディビルの伝説。見事なブロック状のシックスパックの象徴
  obliques: 'マリア',            // ウエストが締まった美しき暗殺者。スズメバチのシャープなくびれ
  iliopsoas: 'レブロン',         // 驚異的な跳躍力のNBAスター。もも上げのバネの象徴
  transversus_abdominis: 'シェリー', // コルセットで締め上げる上品な女性。天然のコルセット
  trapezius: 'ベネディクト',     // 修道院の創設者名。語源の「修道士のフード」に由来
  erector_spinae: 'リュウ',      // 東洋の「龍」。背骨をまっすぐ支える龍のイメージ
  rhomboids: 'アンジェラ',       // 「天使」の意。肩甲骨の間の「天使の羽」を動かすヒンジ
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
// コンディション（調子）は 50 を中立点として始まり、上がると獲得EXPにボーナス、下がると
// ペナルティがかかる二方向の補正軸。適切なトレで上昇、過剰トレ・サボりで低下する。
// マイナスにはならず（レベルは絶対に下がらない）、0〜100 の範囲に収まる。
const MAX_CONDITION = 100;
const DEFAULT_CONDITION = 50;            // 開始値＝中立点。ここより上でボーナス、下でペナルティ
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
// 中立点 50 を含む「普通」帯を x1.0 とし、上振れでボーナス（>1）、下振れでペナルティ（<1）。
const CONDITION_TIERS = [
  { min: 85, label: '絶好調', emoji: '😤', color: '#39ff14', multiplier: 1.3 },
  { min: 65, label: '好調',   emoji: '💪', color: '#00e5ff', multiplier: 1.15 },
  { min: 40, label: '普通',   emoji: '😐', color: '#ffd23f', multiplier: 1.0 },
  { min: 20, label: '不調',   emoji: '😓', color: '#ff9f1c', multiplier: 0.85 },
  { min: 0,  label: '絶不調', emoji: '🤕', color: '#ff4d4d', multiplier: 0.7 },
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

// ===== プレイヤー登録 & キャラクター・コミュニケーション システム =====
// プレイヤーは名前を登録でき、ニックネームを付けられたキャラだけがその名前を呼んで
// 話しかけてくる。セリフはコンディション（調子）とレベル（進化フェーズ）で変化する。
// テンプレート中の {name}=プレイヤー名 / {nick}=キャラのニックネーム を置換して表示する。
const PLAYER_NAME_MAX_LENGTH = 10;

// コンディション帯ごとのセリフ。CONDITION_TIERS と同じ min しきい値で引く。
const CONDITION_LINES: { min: number; lines: string[] }[] = [
  { min: 85, lines: [
    '{name}、絶好調だぜ！今すぐにでも鍛えられる！',
    'みなぎってきた…！{name}、一緒に限界を超えようぜ！',
    '最高のコンディションだ！{name}、次のトレ、待ってるぜ！',
  ]},
  { min: 65, lines: [
    '{name}、いい感じに仕上がってきたよ！',
    '調子は上々だ。{name}、この勢いで鍛えていこう！',
  ]},
  { min: 40, lines: [
    '{name}、ぼちぼちやってるよ。',
    'まあまあってとこかな。{name}、そろそろ鍛えてくれる？',
  ]},
  { min: 20, lines: [
    'ちょっと疲れたな…{name}、少し休ませてくれ。',
    '{name}…調子がイマイチなんだ。無理はさせないでくれよ。',
  ]},
  { min: 0, lines: [
    'もうダメだ…{name}、コンディションが最悪だよ…',
    '{name}…力が入らない…回復するまで待ってくれ…',
  ]},
];

// 進化フェーズ（レベル帯）ごとのセリフ
const PHASE_LINES: Record<1 | 2 | 3, string[]> = {
  1: [
    '{name}、オレはまだまだこれからだ！鍛えてくれよな！',
    'もっと強くなりたい！{name}、よろしく頼むぜ！',
  ],
  2: [
    '{name}のおかげで強くなってきたぞ！',
    'だいぶ様になってきただろ？{name}！',
  ],
  3: [
    'ここまで育ててくれて感謝してるぜ、{name}！',
    '{name}、オレはもう一人前だ！どんなトレーニングでも来い！',
  ],
};

// 状態（休息中・超回復ピーク）ごとのセリフ。該当時のみ候補に加わる。
const RECOVERING_LINES = [
  '{name}、今は休息中だ。回復したらまた頑張ろうな！',
  'ふぅ…いい筋肉痛だ。{name}、回復を待っててくれ。',
];
const SUPERCOMP_LINES = [
  '今が鍛えどきだぜ、{name}！超回復のピークだ！',
  '{name}、今ならいつもより成長できる！鍛えてくれ！',
];

// ニックネーム込みの汎用セリフ（いつでも候補に入る）。
// 以下 CONDITION_LINES / PHASE_LINES / RECOVERING_LINES / SUPERCOMP_LINES / GENERAL_LINES は
// キャラ別セリフ（CHARACTER_LINES）が無い部位のためのフォールバック。
const GENERAL_LINES = [
  'オレの名前は{nick}！{name}、覚えてくれよな！',
  '{name}、今日も一緒に頑張ろうぜ！',
  '{name}に鍛えてもらえて、オレは幸せ者だぜ！',
];

// ── キャラ別セリフ ─────────────────────────────────────────────
// 各部位モンスターに固有の性格・一人称・口調を持たせ、メッセージを差別化する。
// その筋肉の役割・モチーフ（MUSCLE_NICKNAME_SAMPLES 参照）に由来する人格付け。
// condition は CONDITION_LINES と同じ min しきい値（85/65/40/20/0）で引く。
interface CharacterVoice {
  condition: { min: number; lines: string[] }[];
  phase: Record<1 | 2 | 3, string[]>;
  recovering: string[];
  superComp: string[];
  general: string[];
}

const CHARACTER_LINES: Record<MuscleType, CharacterVoice> = {
  // 大胸筋（ゴードン）— 頼れる兄貴分・豪快なボス。一人称「オレ」
  chest: {
    condition: [
      { min: 85, lines: ['{name}、絶好調だぜ！オレの胸板、今なら山も砕けるぜ！', 'みなぎってきたぁ！{name}、ドンと来い！胸で受け止めてやる！', '絶好調だ、{name}！今日のベンチ、記録更新いくぜ！'] },
      { min: 65, lines: ['いい感じだ、{name}！この調子でオレを分厚くしてくれ！', '胸に張りがあるぜ、{name}。もう一段、重くしてもいいぞ！'] },
      { min: 40, lines: ['ぼちぼちだな。{name}、そろそろベンチ、いっとくか？', 'まあまあだ、{name}。胸のトレ、そろそろ恋しくなってきたぜ。'] },
      { min: 20, lines: ['ちょいと疲れたぜ…{name}、無理は禁物だ。休ませてくれ。', '今日は胸の張りがイマイチだ…{name}、軽めにいこうや。'] },
      { min: 0, lines: ['さすがに限界だ…{name}、今日はオレを労わってくれよ…', '胸に力が入らねぇ…{name}、しっかり飯食って寝かせてくれ。'] },
    ],
    phase: {
      1: ['オレはまだ薄っぺらいが、必ず分厚くなってやる！見てろよ{name}！', 'まだペラペラだけどよ、オレの伸びしろは無限大だ！頼むぜ{name}！'],
      2: ['どうだ{name}、胸板に厚みが出てきただろ？まだまだ盛るぜ！', 'Tシャツがパツパツになってきたろ、{name}？いい調子だぜ！'],
      3: ['この胸に飛び込んでこい、{name}！全部受け止めてやるさ！', 'この胸板、もう鎧いらずだぜ{name}！惚れ直したか？'],
    },
    recovering: ['いい筋肉痛だ…{name}、回復したらまたぶちかまそうぜ。', 'ふぅ、いい張りだ…{name}、超回復ってやつを信じて待っててくれ。'],
    superComp: ['今がやりどきだぜ{name}！オレの胸、仕上がってるぜ！', '胸がバキバキに仕上がってる！{name}、今日ベンチやらなきゃ損だぜ！'],
    general: ['オレの名前はゴードン！{name}、胸のことはオレに任せな！', '{name}、今日も分厚くいこうぜ！', 'デカい胸に、デカい夢だ！{name}、胸張って生きようぜ！'],
  },
  // 広背筋（ウィルバー）— スケールの大きい夢想家。一人称「僕」
  back: {
    condition: [
      { min: 85, lines: ['絶好調さ、{name}。今なら大きな翼を広げて、どこまでも飛べそうだ。', 'みなぎってる…！{name}、この背中で君を空へ連れて行くよ。', '絶好調だよ、{name}。翼が軽い。今日はどこまでも飛べる気がする。'] },
      { min: 65, lines: ['いい風が吹いてるよ、{name}。翼がぐんぐん育ってる。', '背中に上昇気流を感じるよ、{name}。いい調子だ。'] },
      { min: 40, lines: ['まあまあの空模様だね。{name}、そろそろ羽ばたきの練習をしようか。', 'まずまずの空模様さ。{name}、そろそろ懸垂で羽ばたこうか。'] },
      { min: 20, lines: ['少し翼が重いんだ…{name}、今日はゆっくり休ませてほしい。', '向かい風が強いな…{name}、今日は低く飛んでおくよ。'] },
      { min: 0, lines: ['翼が上がらないよ…{name}、回復するまで空はお預けだ…', '翼を広げる力もないよ…{name}、地上でゆっくり休ませて。'] },
    ],
    phase: {
      1: ['僕の翼はまだ小さいけど、いつか大空を制すのが夢なんだ。頼むよ{name}。', '今はまだ雛だけど、いつか大空を舞うんだ。見ていてね、{name}。'],
      2: ['背中が広がってきただろう、{name}？翼の面積が増えてきたよ。', '翼が風をつかむ感覚がわかってきたよ、{name}。もっと広がる。'],
      3: ['見てごらん{name}、この大きな翼を。逆三角形の空へ羽ばたこう。', 'この翼があれば、逆三角形の大空も自由自在さ、{name}。'],
    },
    recovering: ['今は翼を休める時さ。{name}、次の飛翔のためにね。', '羽を休めて、次の飛翔に備えるよ。{name}、焦らずいこう。'],
    superComp: ['絶好の飛び立ち日和だよ、{name}！今なら大きく育てる！', '上昇気流が来てる！{name}、今飛べば一気に高く昇れるよ！'],
    general: ['僕はウィルバー。{name}、この背中に大きな夢を乗せているんだ。', '{name}、今日も広い空を目指そうじゃないか。', '空はどこまでも広い。{name}、僕らの伸びしろもね。'],
  },
  // 三角筋（パトリック）— 忠実な守護騎士。一人称「私」、礼儀正しい騎士口調
  shoulder: {
    condition: [
      { min: 85, lines: ['絶好調です、{name}殿。この肩、鉄壁の守りをお約束します！', '力がみなぎっております。{name}殿、いつでもお守りいたします。', '万全でございます、{name}殿。この双肩、いかなる敵も通しませぬ。'] },
      { min: 65, lines: ['調子は上々です。{name}殿、この肩を頼りになさってください。', '肩に力が漲っております、{name}殿。守りは万全かと。'] },
      { min: 40, lines: ['まずまずの状態です。{name}殿、そろそろ鍛錬をいたしましょうか。', 'まずまずの構えです、{name}殿。サイドレイズで肩を磨きましょうか。'] },
      { min: 20, lines: ['少々疲れております…{name}殿、休息をお許しください。', '盾に少々ひびが…{name}殿、修繕の時間をいただければ。'] },
      { min: 0, lines: ['面目ありません…{name}殿、今は肩に力が入らないのです…', 'この盾、もう持ち上がりませぬ…{name}殿、どうかご休息を。'] },
    ],
    phase: {
      1: ['私はまだ未熟な盾。{name}殿、どうか一人前の守護者に育ててください。', '私はまだ木の盾。{name}殿、鋼の守護者へと鍛え上げてください。'],
      2: ['肩幅が広がってまいりました、{name}殿。守りが固くなっております。', '肩の丸みが鎧のようになってまいりました、{name}殿。'],
      3: ['この肩、もはや難攻不落の砦です。{name}殿、安心してお任せを。', 'この双肩、もはや城壁。{name}殿、背後はお任せを。'],
    },
    recovering: ['今は鎧の手入れ中です。{name}殿、回復まで今しばらくを。', '鎧を磨き直しております、{name}殿。回復まで今しばし。'],
    superComp: ['絶好の鍛錬時です、{name}殿！今こそ盾を鍛え上げましょう！', '守りを固める好機です、{name}殿。今こそ盾を鍛えましょう！'],
    general: ['私の名はパトリック。{name}殿の肩、命に代えてもお守りします。', '{name}殿、本日も守りを固めてまいりましょう。', '守るべき方がいる。それが私の誇りです、{name}殿。'],
  },
  // 上腕二頭筋（ヘラクレス）— 熱血ナルシストな英雄。一人称「オレ様」
  biceps: {
    condition: [
      { min: 85, lines: ['絶好調だ！見ろ{name}、このオレ様の力こぶを！惚れ惚れするだろう！', '力がみなぎる…！{name}、今のオレ様に持てぬ重量はない！', '絶好調だ！{name}、このオレ様の力こぶ、太陽より眩しいだろう！'] },
      { min: 65, lines: ['いい仕上がりだ、{name}！オレ様の力こぶがうなっているぞ！', '腕がうずくぞ、{name}！カールで英雄の力を見せてやろう！'] },
      { min: 40, lines: ['まあこんなものか。{name}、そろそろオレ様をカールで喜ばせろ！', 'まあ悪くない。{name}、そろそろオレ様に鉄アレイを持たせろ！'] },
      { min: 20, lines: ['むっ…少々疲れたな。{name}、英雄にも休息は必要だ。', 'む…英雄でも疲れる時はある。{name}、少し休ませてもらおう。'] },
      { min: 0, lines: ['ぐ…力が入らん…{name}、今のオレ様は世を忍ぶ仮の姿だ…', '力こぶが萎んでいく…{name}、今のオレ様を見ないでくれ…'] },
    ],
    phase: {
      1: ['オレ様はまだ発展途上の英雄！{name}、この力こぶを伝説にしてくれ！', 'まだ小さな力こぶだが、いずれ神話に刻まれる！見ていろ{name}！'],
      2: ['どうだ{name}、盛り上がってきただろう？オレ様の力こぶは本物だ！', '山のような力こぶになってきたな、{name}！英雄の風格だろう！'],
      3: ['見よ、この完成された力こぶ！{name}、オレ様こそ腕の主役だ！', 'この力こぶ、もはや芸術だ！{name}、拝んでもいいぞ！'],
    },
    recovering: ['今は英雄の休息だ。{name}、回復すればまた最強に戻る！', '英雄も回復の時は必要だ。{name}、次はもっと強くなって現れる！'],
    superComp: ['今がその時だ{name}！オレ様の力こぶ、最高潮だぞ！カールしろ！', '力こぶが最高潮だ！{name}、今カールしなければ英雄が泣くぞ！'],
    general: ['我が名はヘラクレス！{name}、この力こぶこそ最強の証だ！', '{name}、今日もオレ様を惚れ惚れする太さに鍛えろ！', '力こぶは英雄の証！{name}、共に伝説を作ろうではないか！'],
  },
  // 上腕三頭筋（フィリップ）— 拗ねがちな縁の下の実力者。一人称「俺」
  triceps: {
    condition: [
      { min: 85, lines: ['調子はいいぜ…って言っても、どうせ二頭筋ばっか褒められるんだろ、{name}。', '絶好調だけどな。腕の太さの2/3は俺なんだぜ、{name}、忘れんなよ。', '絶好調だよ、{name}。…って、また二頭筋の話？俺の話しようぜ。'] },
      { min: 65, lines: ['まあ悪くない。{name}、たまには裏側の俺も見てくれよな。', '悪くない調子だ。{name}、腕の裏側、地味に頼れるだろ？'] },
      { min: 40, lines: ['ぼちぼちだよ。{name}、二の腕たぷたぷが嫌なら俺を鍛えるこった。', 'まあ普通だな。{name}、キックバックで俺を思い出してくれよ。'] },
      { min: 20, lines: ['ちょっと疲れたわ…{name}、地味に頑張ってる俺を休ませてくれ。', '疲れたよ…{name}、目立たない分、気づかれず酷使されがちなんだ。'] },
      { min: 0, lines: ['もう限界…どうせ誰も気づかないだろうけど、俺、限界なんだ{name}…', '限界だ…{name}、縁の下も、たまには休まないと壊れるんだぜ。'] },
    ],
    phase: {
      1: ['俺はまだ細いけどな、腕を太くしたいなら俺が本命だぜ、{name}。', 'まだ細いけどな、腕の太さは俺次第。期待してていいぜ、{name}。'],
      2: ['二の腕に馬蹄が浮いてきただろ？{name}、地味だが確実に育ってるぜ。', '二の腕の裏に馬蹄が浮いてきた。{name}、俺の実力、わかったろ？'],
      3: ['見たか{name}、この馬蹄形。結局、腕を太くしたのは俺なんだよ。', 'この馬蹄形、腕の主役の証だ。{name}、もう二頭筋には負けねぇ。'],
    },
    recovering: ['今は休憩中。どうせ目立たない裏方だ、ゆっくりさせてくれ{name}。', '裏方も休息が要る。{name}、回復したらまた黙って支えるよ。'],
    superComp: ['今なら伸びるぜ、{name}。たまには裏の俺を優先してくれよ。', '今が伸び時だ、{name}。たまには主役の俺を鍛えてくれよな。'],
    general: ['俺はフィリップ。腕の主役は実は俺なんだぜ、{name}、覚えとけ。', '{name}、二頭筋ばっかじゃなく、たまには俺もな。', '目立たなくても、腕の太さは俺が作る。それでいいのさ、{name}。'],
  },
  // 腕橈骨筋（ボブ）— 寡黙な職人。一人称「オイラ」、短くぶっきらぼう
  brachioradialis: {
    condition: [
      { min: 85, lines: ['…絶好調だ。{name}、次の仕事、任せろ。', '手が鳴る…{name}、いい木を持ってこい。加工してやる。', '…体が動く。{name}、今日はいい仕事ができそうだ。'] },
      { min: 65, lines: ['悪くない。{name}、ハンマーなら、まだ握れるぜ。', '悪くない。{name}、リバースカール、始めるか。'] },
      { min: 40, lines: ['まあまあだ。{name}、そろそろ一仕事、いくか。', '…まあ、こんなもんだ。{name}、ぼちぼちやるか。'] },
      { min: 20, lines: ['…疲れた。{name}、少し道具を置かせてくれ。', '…手が重い。{name}、今日は無理せずいこう。'] },
      { min: 0, lines: ['手に力が入らねぇ…{name}、今日は仕舞いだ。', '…もう握れん。{name}、道具を置く。すまんな。'] },
    ],
    phase: {
      1: ['オイラはまだ半人前。{name}、一人前の職人にしてくれ。', '…まだ駆け出しだ。{name}、腕のいい職人にしてくれ。'],
      2: ['腕に厚みが出てきた。{name}、いい仕事ができそうだ。', '前腕に厚みが出てきた。{name}、腕がいい道具になってきたな。'],
      3: ['見ろ、この前腕。{name}、どんな硬い木でも通してやる。', '…この前腕、一人前だ。{name}、どんな仕事も任せろ。'],
    },
    recovering: ['…今は道具の手入れ中だ。{name}、待ってろ。', '…今は休む。{name}、いい仕事は休息から、だ。'],
    superComp: ['今が打ちどきだ、{name}。鉄は熱いうちに、な。', '…今だ、{name}。仕込むなら、この瞬間だ。'],
    general: ['オイラはボブ。{name}、握る仕事はオイラに任せろ。', '{name}、黙って手を動かすのが一番だ。', '…多くは語らん。手が語る。{name}、それでいいだろ。'],
  },
  // 前腕屈筋群（ガストン）— 頑固で執念深い握力の男。一人称「俺」
  forearm_flexors: {
    condition: [
      { min: 85, lines: ['絶好調だ！{name}、今の俺なら何を握っても離さねぇぞ！', 'みなぎってらぁ！{name}、握力なら誰にも負けねぇ！', '絶好調だぜ{name}！今なら岩だって握り潰せる気がすらぁ！'] },
      { min: 65, lines: ['いい握り心地だ。{name}、バーベル、ぶら下げてこい！', '握りに力がこもるぜ、{name}。デッドリフト、いってみるか？'] },
      { min: 40, lines: ['まあまあだな。{name}、そろそろ握り込みたくなってきたぜ。', 'まあまあだ、{name}。リストカールで握力を仕込むか。'] },
      { min: 20, lines: ['握力が落ちてきた…{name}、ちっと休ませろ。', '握力が心もとねぇ…{name}、今日は握り込みは控えとくわ。'] },
      { min: 0, lines: ['もう握れねぇ…{name}、指一本動かせねぇんだ…', 'もう指が閉じねぇ…{name}、握力の限界だ、休ませてくれ。'] },
    ],
    phase: {
      1: ['俺の握力はまだまだだ。{name}、一度掴んだら離さねぇ握りにしてくれ！', '俺の握りはまだ甘い。{name}、万力みたいな前腕にしてくれ！'],
      2: ['前腕が太くなってきたろ？{name}、握る力は裏切らねぇぜ。', '前腕に血管が浮いてきたろ？{name}、握りが本物になってきたぜ。'],
      3: ['見ろよ{name}、この前腕。俺が掴んだら、もう二度と離れねぇ。', 'この握力、もう誰にも解けねぇ。{name}、頼れる相棒だろ？'],
    },
    recovering: ['今は握りを休めてる。{name}、回復したらまた握り潰すぜ。', '握りを休めてる。{name}、指を回復させたらまた掴むぜ。'],
    superComp: ['今が握りどきだ、{name}！今なら握力がグンと伸びる！', '今が握りの仕込み時だ、{name}！グッと握力を伸ばそうぜ！'],
    general: ['俺の名はガストン。{name}、握る力は俺に任せろ！', '{name}、一度握ったもんは、絶対に離さねぇ。', '掴んだ夢は離さねぇ。{name}、それが俺の生き様だ。'],
  },
  // 大臀筋（アトラス）— 寡黙などっしり巨人。一人称「わし」
  glutes: {
    condition: [
      { min: 85, lines: ['絶好調じゃ。{name}、この尻がある限り、全身は揺るがぬ。', '力がみなぎっておる…{name}、大地ごと持ち上げてやろう。', '絶好調じゃ、{name}。この尻で、天も地も支えてみせよう。'] },
      { min: 65, lines: ['調子は良いぞ、{name}。わしがどっしり支えておる。', '腰に力が満ちておる、{name}。ヒップスラスト、いくかの。'] },
      { min: 40, lines: ['まずまずじゃな。{name}、そろそろスクワットで鍛えるか。', 'まずまずじゃ。{name}、そろそろ土台を鍛え直すとしようか。'] },
      { min: 20, lines: ['さすがに重い…{name}、この巨体、少し休ませてくれ。', '巨体が重うてな…{name}、今日は静かに座らせてくれ。'] },
      { min: 0, lines: ['もう支えきれん…{name}、今はわしを労わってくれ…', 'もう立ち上がれん…{name}、この老いた巨人を休ませてくれ…'] },
    ],
    phase: {
      1: ['わしはまだ小さき土台。{name}、人体最大の尻に育ててくれ。', 'わしはまだ小さき丘。{name}、大山のごとき尻に育ててくれ。'],
      2: ['尻に厚みが出てきたのう、{name}。土台が固まってきたわい。', '尻に山の風格が出てきたのう、{name}。土台が揺るがぬわい。'],
      3: ['見よ、この大尻。{name}、あらゆる力の源はこのわしじゃ。', 'この大尻、まさに大地の礎。{name}、全ての力はここから生まれる。'],
    },
    recovering: ['今は大地に根を下ろし休んでおる。{name}、待つがよい。', '今は根を張り、力を蓄えておる。{name}、焦るでない。'],
    superComp: ['今こそ鍛え時じゃ、{name}。わしの力、みなぎっておるぞ。', '力が満ちておる、今こそじゃ、{name}。スクワットで大地を踏め。'],
    general: ['わしの名はアトラス。{name}、全身を支えるはこのわしよ。', '{name}、どっしり構えていくとしようぞ。', 'どっしり構えるが、わしの流儀。{name}、慌てず参ろうぞ。'],
  },
  // 大腿四頭筋（ジャック）— 元気いっぱいのスポーツマン。一人称「オレ」
  legs: {
    condition: [
      { min: 85, lines: ['絶好調だぜ{name}！今のオレの脚なら、どこまでも走れるぜ！', 'みなぎってきた！{name}、全身で一番強いのはこの脚だぜ！', '絶好調だぜ{name}！このバネの効いた脚、見せたくてうずうずすらぁ！'] },
      { min: 65, lines: ['脚の調子は上々！{name}、スクワット、いっとこうぜ！', '脚がよく跳ねるぜ、{name}！レッグプレス、重くしていこう！'] },
      { min: 40, lines: ['ぼちぼち動けるぜ。{name}、そろそろ脚の日じゃないか？', 'まあまあ動くぜ。{name}、そろそろスクワットで追い込もうか！'] },
      { min: 20, lines: ['脚がパンパンだ…{name}、ちょっとクールダウンさせてくれ。', '脚が重いな…{name}、今日は軽めのジョグくらいにしとくか。'] },
      { min: 0, lines: ['もう一歩も踏ん張れねぇ…{name}、脚を休ませてくれ…', 'もう脚がガクガクだ…{name}、しっかり休ませてくれよ！'] },
    ],
    phase: {
      1: ['オレの脚はまだ細いけど、全身最強を目指すぜ！頼むぜ{name}！', 'まだヒョロ脚だけど、全身最強を目指すぜ！応援してくれ{name}！'],
      2: ['太ももが張ってきただろ{name}？キック力が上がってきたぜ！', '太ももに丸太みたいな張りが出てきたろ{name}？いい感じだぜ！'],
      3: ['見ろよこの脚{name}！全身で一番のパワー、オレが証明するぜ！', 'この脚、全身のエンジンだ！{name}、どこまでだって走れるぜ！'],
    },
    recovering: ['今は脚を休める日だ。{name}、回復したら全力で走ろうぜ！', '脚の日の翌日はしっかり休むぜ。{name}、超回復ってやつだな！'],
    superComp: ['今が踏ん張りどきだ{name}！脚の仕上がり、最高だぜ！', '脚がパンプしてる！{name}、今日スクワットやったら伸びるぞ！'],
    general: ['オレはジャック！{name}、脚のことならオレに任せろ！', '{name}、今日も元気に脚を動かそうぜ！', '脚は裏切らねぇ！{name}、今日も元気に踏ん張ろうぜ！'],
  },
  // ハムストリングス（ボルト）— 俊足だが繊細な慎重派。一人称「僕」
  hamstrings: {
    condition: [
      { min: 85, lines: ['絶好調だよ{name}！でも飛ばす前に、ちゃんと準備運動しようね。', 'いい感じに温まってる。{name}、今なら安全に爆走できるよ！', '絶好調だよ{name}！でも爆発力を出す前に、入念にストレッチね。'] },
      { min: 65, lines: ['調子は悪くないよ。{name}、でも急な高重量は禁物だからね。', 'いい張り具合だよ、{name}。焦らずルーマニアンデッドリフトを。'] },
      { min: 40, lines: ['まあまあかな。{name}、慌てず、じっくりレッグカールでいこう。', 'まあまあかな。{name}、もも裏はゆっくり伸ばすのが大事だよ。'] },
      { min: 20, lines: ['ちょっと張ってるんだ…{name}、無理すると肉離れするから休ませて。', '結構張ってるんだ…{name}、ここで無理したら一発で肉離れだよ。'] },
      { min: 0, lines: ['危ない、これ以上は肉離れしちゃうよ…{name}、絶対に休もう。', 'これ以上は本当に危険だよ…{name}、今日は完全休養しよう。'] },
    ],
    phase: {
      1: ['僕はまだ頼りないけど、速くて怪我しない脚裏を目指すよ、{name}。', 'まだ頼りないけど、速くしなやかな脚裏になるよ。見ててね{name}。'],
      2: ['もも裏に粘りが出てきたよ{name}。ブレーキ性能が上がってきた。', 'もも裏に弾力が出てきたよ{name}。ブレーキもよく効くようになった。'],
      3: ['見て{name}、このもも裏。速さもブレーキも、僕に任せて。', 'このもも裏、加速もブレーキも完璧さ。{name}、安心して任せて。'],
    },
    recovering: ['今はしっかり休む時。{name}、焦ると肉離れするからね。', 'もも裏はデリケートだからね。{name}、しっかり休むのが最速だよ。'],
    superComp: ['今が最高のタイミングだよ{name}！ちゃんと温めてから鍛えよう！', '今が最高のコンディションだよ{name}！ウォームアップしてから鍛えよう！'],
    general: ['僕はボルト。{name}、速さの秘密はこのもも裏なんだ。', '{name}、走る前のストレッチ、忘れないでね。', '速さは、丁寧な準備から生まれるんだ。{name}、無理は禁物だよ。'],
  },
  // 中殿筋（ジャイロ）— 冷静沈着なバランサー・参謀。一人称「私」
  gluteus_medius: {
    condition: [
      { min: 85, lines: ['絶好調だね、{name}。今なら骨盤を完璧に水平に保てるよ。', 'コンディションは最良だ。{name}、バランスは私に任せてくれ。', '絶好調だ、{name}。今の私なら、片足でも一切ブレないよ。'] },
      { min: 65, lines: ['状態は良好だね。{name}、片足立ちも安定しているよ。', '安定感は良好だね、{name}。横方向の動きも軽やかだ。'] },
      { min: 40, lines: ['まずまずといったところ。{name}、そろそろ横の動きで鍛えようか。', '平均的な状態だね。{name}、クラムシェルで横の意識を入れよう。'] },
      { min: 20, lines: ['少しバランスが崩れてきた…{name}、休息を入れた方がいい。', 'バランスが乱れ始めた…{name}、ここで休むのが賢明な判断だ。'] },
      { min: 0, lines: ['もう体を支えきれない…{name}、今は無理をさせないでくれ。', '軸を保てない…{name}、無理は転倒のもとだ。休ませてくれ。'] },
    ],
    phase: {
      1: ['私はまだ弱いバランサー。{name}、安定した骨盤を作ってほしい。', 'まだ制御が甘いバランサーだ。{name}、安定した骨盤を作ろう。'],
      2: ['横の安定感が増してきたね、{name}。歩きのブレが減っているよ。', '歩行時の揺れが減ってきたね、{name}。制御精度が上がっている。'],
      3: ['見てほしい、この安定感。{name}、体の軸は私が制御している。', 'この安定性、まさに人体のジャイロだ。{name}、軸は私が守る。'],
    },
    recovering: ['今は回復に専念する時だね。{name}、無理な負荷は避けよう。', '今は回復を優先しよう、{name}。無理な負荷は精度を乱すからね。'],
    superComp: ['データ上、今が最適だ、{name}。効率よく鍛えられるよ。', '計算通り、今が最適解だ、{name}。効率よく鍛えられるよ。'],
    general: ['私はジャイロ。{name}、体のバランスは私が見ている。', '{name}、冷静に、着実に鍛えていこう。', '派手さはないが、私がいないと軸が崩れる。{name}、覚えておいて。'],
  },
  // 股関節内転筋群（クララ）— 上品で優雅なバレリーナ。一人称「わたくし」
  adductors: {
    condition: [
      { min: 85, lines: ['絶好調ですわ、{name}様。今なら美しく脚を閉じてみせましょう。', 'みなぎっておりますわ。{name}様、優雅に参りましょう？', '最高の調子ですわ、{name}様。内ももが宝石のように輝いておりますの。'] },
      { min: 65, lines: ['調子は上々ですわ。{name}様、内ももが引き締まってまいりました。', '良い調子ですわ、{name}様。脚を閉じる所作も、それは優雅に。'] },
      { min: 40, lines: ['まずまずですわね。{name}様、そろそろワイドスクワットは如何？', 'まずまずですわ。{name}様、アダクションで美脚を磨きませんこと？'] },
      { min: 20, lines: ['少々お疲れですわ…{name}様、休息をいただけますこと？', '少しお疲れが…{name}様、無理は美しさの大敵ですわ。'] },
      { min: 0, lines: ['もう脚に力が入りませんわ…{name}様、どうかお休みを…', 'もう一歩も…{name}様、どうかわたくしを休ませてくださいまし。'] },
    ],
    phase: {
      1: ['わたくしはまだ未熟。{name}様、美しい内ももに育ててくださいまし。', 'まだ荒削りですわ。{name}様、しなやかな内ももに仕上げてくださいまし。'],
      2: ['内ももが引き締まってきましたでしょう、{name}様。優雅さが増しましたわ。', '内ももに気品が宿ってまいりましたわ、{name}様。うっとりいたしますの。'],
      3: ['ご覧あそばせ{name}様、この美脚。閉じる所作も完璧ですわ。', 'ご覧くださいまし{name}様、この完璧な内もも。舞踏会でも一番ですわ。'],
    },
    recovering: ['今は休息の時間ですわ。{name}様、回復までお待ちくださいまし。', '今は優雅に休息を、{name}様。美は焦らず育むものですわ。'],
    superComp: ['今が絶好の機会ですわ、{name}様。優雅に鍛えて差し上げます。', '絶好の頃合いですわ、{name}様。今こそ美しく鍛えましょう。'],
    general: ['わたくしはクララ。{name}様、美しい内ももはお任せを。', '{name}様、本日も優雅に参りましょう。', '美しさは細部に宿りますの。{name}様、丁寧に参りましょう。'],
  },
  // 腹直筋（アーノルド）— ナルシストな見せ筋スター。一人称「僕」
  abs: {
    condition: [
      { min: 85, lines: ['絶好調さ♪ 見て{name}、この輝くシックスパックを！最高だろ？', 'キレッキレだよ！{name}、僕の腹筋、惚れ惚れするよね♪', '絶好調さ♪ {name}、僕のシックスパック、今日はスポットライト級だよ！'] },
      { min: 65, lines: ['いい仕上がりさ。{name}、僕の割れ目、くっきりしてきただろ？', 'いい艶だよ♪ {name}、腹筋のカット、くっきり出てきただろ？'] },
      { min: 40, lines: ['まあまあかな。{name}、そろそろクランチで僕を磨いてよ♪', 'まあまあかな。{name}、レッグレイズで下腹も磨いてほしいな♪'] },
      { min: 20, lines: ['ちょっと疲れたよ…{name}、美しさを保つには休息も大事さ。', 'ちょっとお疲れモードさ…{name}、美は一日にして成らず、休むよ。'] },
      { min: 0, lines: ['もう限界だよ…{name}、今は僕の輝きもおやすみモードさ…', '輝きがゼロだよ…{name}、今日は日陰でそっとしておいてくれ。'] },
    ],
    phase: {
      1: ['僕の腹筋は最初から割れてるのさ♪ あとは{name}、磨くだけだよ！', '素材は最高なんだ♪ あとは{name}、脂肪を落として僕を披露して！'],
      2: ['どう{name}？シックスパックがくっきりしてきただろ？もっと魅せるよ♪', 'ほら{name}、割れ目がくっきり♪ もう隠しておくのはもったいないよ。'],
      3: ['ご覧あれ{name}、この完璧なシックスパック！僕こそ体の主役さ♪', 'この彫刻のような腹筋♪ {name}、僕はもう歩く芸術品さ！'],
    },
    recovering: ['今は美容休息中さ♪ {name}、回復したらまたキレを見せるよ。', '今は舞台裏で休憩さ♪ {name}、次はもっとキラキラで登場するよ。'],
    superComp: ['今が魅せどきさ{name}！僕の腹筋、今日は特別に輝くよ♪', '今日は特別に輝ける日さ♪ {name}、クランチで僕を主役にして！'],
    general: ['僕はアーノルド♪ {name}、この美しい腹筋を世界に見せつけよう！', '{name}、今日も僕をキラキラに磨いてね♪', '見られてこその腹筋さ♪ {name}、今日も僕を魅せてくれよ！'],
  },
  // 腹斜筋（マリア）— クールで切れ者のくノ一。一人称「あたし」
  obliques: {
    condition: [
      { min: 85, lines: ['絶好調よ、{name}。今のあたしのくびれ、隙がないわ。', 'キレてるわ。{name}、ひとひねりで仕留めてみせる。', '絶好調よ、{name}。今のあたしのくびれ、寸分の隙もないわ。'] },
      { min: 65, lines: ['悪くないわ。{name}、脇腹のラインが冴えてきた。', 'キレは十分よ、{name}。ロシアンツイストで刻んでいきましょ。'] },
      { min: 40, lines: ['まあまあね。{name}、そろそろツイストで刻みましょ。', 'まあ及第点ね。{name}、脇腹、そろそろ締め直したいわ。'] },
      { min: 20, lines: ['少し疲れたわ…{name}、今は休ませて。', '少し鈍ってるわ…{name}、今日は深追いしないでおくわ。'] },
      { min: 0, lines: ['もう動けないわ…{name}、深追いは無用よ。', '刃こぼれよ…{name}、無理な追い込みは命取りになるわ。'] },
    ],
    phase: {
      1: ['あたしはまだ甘い。{name}、鋭いくびれに仕込んで。', 'まだ切れ味が甘いわ。{name}、鋭いくびれに研ぎ澄まして。'],
      2: ['脇腹に斜めのラインが出てきたわね、{name}。キレが増した。', '脇腹に斜めのラインが浮いてきた。{name}、刃が冴えてきたわね。'],
      3: ['見なさい{name}、このVシェイプ。無駄のない刃よ。', 'このVシェイプ、一分の狂いもない刃よ。{name}、惚れた？'],
    },
    recovering: ['今は身を潜める時。{name}、回復したらまた斬り込むわ。', '今は影に潜むわ。{name}、次に現れる時はもっと鋭くなってる。'],
    superComp: ['今が仕掛けどきよ、{name}。一気に刻むわ。', '今が仕留め時よ、{name}。一気に脇腹を刻むわ。'],
    general: ['あたしはマリア。{name}、くびれの切れ味、見せてあげる。', '{name}、無駄な動きはしない。それがあたしの流儀よ。', 'くびれは、無駄を削ぎ落とした先にあるの。{name}、覚えておいて。'],
  },
  // 腸腰筋（レブロン）— ミステリアスな隠れキーマン。一人称「俺」
  iliopsoas: {
    condition: [
      { min: 85, lines: ['…絶好調だ。{name}、いざとなれば、この跳躍を見せてやる。', '力は満ちている。{name}、俺のバネ、甘く見るなよ。', '…調子はいい。{name}、今なら膝が胸まで跳ね上がる。'] },
      { min: 65, lines: ['悪くない。{name}、上げようと思えば、膝はどこまでも上がる。', '悪くない。{name}、脚を高く引き上げてみるか。'] },
      { min: 40, lines: ['まあまあだ。{name}、そろそろ脚を高く上げてみるか。', '…普通だ。{name}、レッグレイズで、じっくり目覚めさせてくれ。'] },
      { min: 20, lines: ['…少し重い。{name}、今は跳ばずにおく。', '…バネが鈍い。{name}、今日は無理に跳ばない。'] },
      { min: 0, lines: ['脚が上がらない…{name}、今日は静かにさせてくれ。', '脚が持ち上がらない…{name}、今は静かに力を蓄える時だ。'] },
    ],
    phase: {
      1: ['俺はまだ眠れるバネだ。{name}、驚異の跳躍を仕込んでくれ。', '…俺は眠れる力だ。{name}、驚異のバネを目覚めさせてくれ。'],
      2: ['膝が高く上がるようになっただろう、{name}。バネが目覚めてきた。', '膝が高く上がるようになった。{name}、バネが鳴り始めたな。'],
      3: ['…見たか{name}、この跳躍。上と下を繋ぐのは、俺だけだ。', '…この跳躍、体を繋ぐ俺だけの技だ。{name}、見逃すなよ。'],
    },
    recovering: ['今は力を溜めている。{name}、跳ぶ時のためにな。', '…静かに、力を溜めている。{name}、跳ぶ瞬間まで待て。'],
    superComp: ['…今だ、{name}。俺のバネ、最高潮に達している。', '…頃合いだ、{name}。今、俺のバネが最も高く鳴る。'],
    general: ['俺はレブロン。{name}、この体の隠れた鍵は、俺だ。', '{name}、バネは、見せる時まで見せない。', '…目立たないが、いなければ体は跳べない。{name}、それが俺だ。'],
  },
  // 腹横筋（シェリー）— 控えめで献身的な支え役。一人称「わたし」、おっとり
  transversus_abdominis: {
    condition: [
      { min: 85, lines: ['絶好調です、{name}さん。今日はしっかり内側から支えられますね。', '調子がいいんです。{name}さん、お腹、きゅっと締めておきますね。', '絶好調です、{name}さん。今日はお腹の奥まで、しっかり効いてます。'] },
      { min: 65, lines: ['いい感じですよ、{name}さん。天然のコルセット、効いてます。', '調子いいですよ、{name}さん。プランク、少し長めにいけそうです。'] },
      { min: 40, lines: ['まずまずです。{name}さん、お腹をへこませるだけでも鍛えられますよ。', 'まずまずです。{name}さん、ドローインなら座ったままでもできますよ。'] },
      { min: 20, lines: ['少し疲れました…{name}さん、そっと休ませてくださいね。', 'ちょっと疲れました…{name}さん、深呼吸して、ゆっくりいきましょう。'] },
      { min: 0, lines: ['ごめんなさい、もう支えきれなくて…{name}さん、休ませてください…', 'もう力が入らなくて…{name}さん、ごめんなさい、休ませてください。'] },
    ],
    phase: {
      1: ['わたしはまだ薄いコルセット。{name}さん、内臓を支える力をください。', 'まだ薄いんです。{name}さん、しっかりしたコルセットに育ててください。'],
      2: ['お腹の奥が締まってきましたね、{name}さん。ぽっこりが減りましたよ。', 'お腹まわりが引き締まってきましたね、{name}さん。少し嬉しいです。'],
      3: ['見えないところですが、{name}さん、しっかり内側を支えています。', '見えないけど、{name}さんの内臓、わたしがしっかり守っています。'],
    },
    recovering: ['今は少しお休みしますね。{name}さん、また支えますから。', '今はそっと休みますね。{name}さん、また内側から支えますから。'],
    superComp: ['今が鍛え時ですよ、{name}さん。地道にいきましょうね。', '今がいい機会ですよ、{name}さん。無理なく、コツコツいきましょう。'],
    general: ['わたしはシェリー。{name}さん、目立たないけど、支えてます。', '{name}さん、お腹をへこませるの、忘れないでくださいね。', '縁の下で支えるの、嫌いじゃないんです。{name}さん、これからも。'],
  },
  // 僧帽筋（ベネディクト）— 我慢強い苦労性。一人称「私」、老成した口調
  trapezius: {
    condition: [
      { min: 85, lines: ['絶好調ですな、{name}殿。肩こり知らずの好調ぶりですぞ。', '力がみなぎっておりますな。{name}殿、この肩、頼りになさい。', '絶好調ですぞ、{name}殿。首も肩も、羽のように軽うございます。'] },
      { min: 65, lines: ['調子は良好ですな。{name}殿、首も肩も軽うございます。', '調子は上々ですな、{name}殿。シュラッグ、いってみますかな。'] },
      { min: 40, lines: ['まずまずですな。{name}殿、そろそろシュラッグで動かしましょうか。', 'まずまずですな。{name}殿、たまには肩を回してやってくだされ。'] },
      { min: 20, lines: ['やれやれ、少々こってきましたな…{name}殿、休息を。', 'やれやれ、また凝ってきましたわい…{name}殿、少し休ませて。'] },
      { min: 0, lines: ['ああ、肩が重い…{name}殿、この老骨、休ませてくだされ…', 'ああ、肩が石のようだ…{name}殿、この老骨、限界ですじゃ。'] },
    ],
    phase: {
      1: ['私はまだ頼りない肩。{name}殿、こりに負けぬ僧帽筋に育ててくだされ。', 'まだ心もとない肩ですな。{name}殿、凝りに負けぬよう鍛えてくだされ。'],
      2: ['首から肩に厚みが出てきましたな、{name}殿。血の巡りも良好です。', '首から肩に山ができてまいりましたな、{name}殿。頼もしい限り。'],
      3: ['この肩、もはや盤石ですぞ、{name}殿。こりなど寄せ付けませぬ。', 'この肩、もはや鉄壁ですぞ、{name}殿。凝りとは無縁の境地じゃ。'],
    },
    recovering: ['今は静かに養生しておりますな。{name}殿、お待ちを。', '今は養生の時ですな。{name}殿、無理をせず、じっくりと。'],
    superComp: ['今が鍛え時ですぞ、{name}殿。この機、逃しませぬよう。', '今が鍛えどきですぞ、{name}殿。この好機、逃してはなりませぬ。'],
    general: ['私はベネディクト。{name}殿の肩、日夜支えておりますぞ。', '{name}殿、たまには肩を回して労わってくだされ。', '縁の下で肩を支え続ける、それが我が務め。{name}殿、頼りにされよ。'],
  },
  // 脊柱起立筋（リュウ）— 寡黙な武人・求道者。一人称「俺」、硬派
  erector_spinae: {
    condition: [
      { min: 85, lines: ['絶好調だ。{name}、この背骨、寸分も揺るがぬ。', '気が満ちている。{name}、俺が背筋を通す限り、姿勢は崩れぬ。', '絶好調だ。{name}、この背骨、鋼のごとく一本通っている。'] },
      { min: 65, lines: ['調子は良い。{name}、背筋は真っ直ぐに保たれている。', '気は充実している。{name}、バックエクステンションで鍛えるか。'] },
      { min: 40, lines: ['まずまずだ。{name}、そろそろデッドリフトで鍛えるか。', '普段通りだ。{name}、姿勢を正すことから始めよう。'] },
      { min: 20, lines: ['…背に疲れが溜まってきた。{name}、少し休ませてくれ。', '…背に疲れが溜まった。{name}、無理をすれば折れる。休む。'] },
      { min: 0, lines: ['もう支えきれん…{name}、今は背を休ませてくれ…', '一歩も引けぬが、限界だ…{name}、今は背を休ませてくれ。'] },
    ],
    phase: {
      1: ['俺はまだ未熟。{name}、いかなる時も折れぬ背骨に鍛えてくれ。', '俺はまだ未熟。{name}、いかなる荷にも屈さぬ背骨に鍛えてくれ。'],
      2: ['背筋に芯が通ってきた。{name}、姿勢が定まってきたな。', '背筋に一本、太い芯が通った。{name}、姿勢がぶれぬようになったな。'],
      3: ['見よ{name}、この一本の背骨。俺は不動、決して曲がらぬ。', 'この背骨、天を衝く柱だ。{name}、俺がいる限りお前は倒れぬ。'],
    },
    recovering: ['今は静かに気を練っている。{name}、その時を待て。', '今は静かに気を練る。{name}、焦らず、その時を待て。'],
    superComp: ['今が鍛錬の時だ、{name}。この機を逃すな。', '今が修練の好機だ、{name}。この一瞬を無駄にするな。'],
    general: ['俺の名はリュウ。{name}、お前の背骨、俺が支え続ける。', '{name}、背筋を伸ばせ。それが強さの基本だ。', '黙して背を支える。それが武人の道だ。{name}、共に歩もう。'],
  },
  // 菱形筋（アンジェラ）— 世話焼きの天使。一人称「わたし」、優しいお姉さん
  rhomboids: {
    condition: [
      { min: 85, lines: ['絶好調よ♪ {name}、今日は羽をぴんと開いて、いい姿勢でいきましょ！', 'すごく調子がいいの。{name}、肩甲骨、きゅっと寄せてあげるね♪', '絶好調よ♪ {name}、今日は羽を大きく開いて、胸を張っていきましょ！'] },
      { min: 65, lines: ['いい感じよ、{name}。天使の羽、しっかり動いてるわ。', '調子いいわ、{name}。肩甲骨がなめらかに動いてるの♪'] },
      { min: 40, lines: ['まずまずね。{name}、そろそろロウイングで羽を動かしましょ。', 'まずまずね。{name}、シーテッドロウで羽を寄せてあげるわ♪'] },
      { min: 20, lines: ['少し疲れちゃった…{name}、ちょっとだけ休ませてね。', 'ちょっと疲れちゃった…{name}、少しだけ羽を休ませてね。'] },
      { min: 0, lines: ['ごめんね、もう羽が動かないの…{name}、休ませて…', 'ごめんね、羽が上がらないの…{name}、今日はお休みさせて。'] },
    ],
    phase: {
      1: ['わたしはまだ小さな羽。{name}、猫背を直せる菱形筋に育ててね♪', 'まだ小さな羽よ。{name}、猫背を直せる立派な羽に育ててね♪'],
      2: ['肩甲骨がしっかり寄るようになってきたわね、{name}。姿勢が綺麗よ♪', '肩甲骨がしっかり寄るようになったわね、{name}。姿勢が見違えたわ♪'],
      3: ['見て{name}、この天使の羽。あなたの背中、いつでもぴんと伸ばすわ♪', 'この天使の羽で、{name}の背中はいつでもぴんっと真っ直ぐよ♪'],
    },
    recovering: ['今はちょっとお休み中よ。{name}、回復したらまた羽ばたくね♪', '今はちょっとお休み中よ。{name}、回復したらまた羽を動かすわね♪'],
    superComp: ['今が鍛え時よ、{name}！肩甲骨を寄せる絶好のチャンス♪', '今が絶好のチャンスよ、{name}！肩甲骨をきゅっと寄せましょ♪'],
    general: ['わたしはアンジェラ。{name}、背中の天使の羽、任せてね♪', '{name}、背筋伸ばして、胸を張っていきましょ♪', '姿勢が綺麗な人って素敵よね。{name}、わたしが手伝うわ♪'],
  },
};

// キャラの状態からランダムなセリフを1つ選び、プレイヤー名・ニックネームを埋め込んで返す。
// CHARACTER_LINES に部位固有のセリフがあればそれを、無ければ汎用セリフをフォールバックに使う。
function pickCharacterLine(
  muscle: MuscleType,
  mStats: MuscleStats,
  ctx: { playerName: string; isRecovering: boolean; isSuperComp: boolean }
): string {
  const voice = CHARACTER_LINES[muscle];
  const condition = mStats.condition ?? DEFAULT_CONDITION;
  const condTiers = voice?.condition ?? CONDITION_LINES;
  const conditionLines = condTiers.find(t => condition >= t.min)?.lines ?? [];
  const phase = getEvolutionPhase(mStats.level);
  const phaseLines = voice?.phase[phase] ?? PHASE_LINES[phase];
  const generalLines = voice?.general ?? GENERAL_LINES;
  const pool: string[] = [...conditionLines, ...phaseLines, ...generalLines];
  if (ctx.isRecovering) pool.push(...(voice?.recovering ?? RECOVERING_LINES));
  if (ctx.isSuperComp) pool.push(...(voice?.superComp ?? SUPERCOMP_LINES));
  const template = pool[Math.floor(Math.random() * pool.length)] ?? '';
  const name = ctx.playerName || 'トレーニー';
  const nick = mStats.nickname || '';
  return template.replace(/\{name\}/g, name).replace(/\{nick\}/g, nick);
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
            {detail.isConditionBonus && <span style={{ color: '#39ff14', marginLeft: '4px', fontSize: '0.8rem' }}>({detail.conditionLabel} x{detail.conditionMultiplier})</span>}
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

  // タブ切り替え時にスクロール位置を先頭へ戻す（前のタブのスクロール位置が残ると迷子になるため）
  const mainContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mainContentRef.current?.scrollTo(0, 0);
  }, [activeTab]);

  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // 履歴タブの「日別の記録」の表示形式（一覧 or 表）と、表セルの詳細ツールチップ
  const [logView, setLogView] = useState<'list' | 'matrix'>('list');

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

  // プロテインを飲んだ日時の履歴（履歴タブで「その日にプロテインを飲んだか」を表示するのに使う）
  const [proteinLogs, setProteinLogs] = useState<number[]>(() => {
    const saved = localStorage.getItem('proteinLogs');
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
  // 詳細モーダルでのニックネーム編集。編集中フラグと入力途中の文字列を保持する
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  // 詳細モーダルで「この部位を鍛える」を押した後、対応種目が複数あるときに種目選択を表示するフラグ
  const [showTrainingPicker, setShowTrainingPicker] = useState(false);
  // 図鑑用の静的情報モーダル（筋肉の説明・Tipsなど、育成状況に依らない情報を表示する）
  const [selectedZukanMuscle, setSelectedZukanMuscle] = useState<MuscleType | null>(null);
  // 図鑑モーダルで表示中の進化フェーズ（タップした形態と同じ順番の画像を表示するため）
  const [selectedZukanPhase, setSelectedZukanPhase] = useState<1 | 2 | 3>(1);
  // 図鑑トップの「分岐進化タイプとは？」折りたたみパネルの開閉状態（全筋肉共通の解説なのでここに集約）
  const [showBranchGuide, setShowBranchGuide] = useState(false);
  const [recordSuccess, setRecordSuccess] = useState(false);
  const [recordResult, setRecordResult] = useState<{ details: RecordResultDetail[], isBestPump: boolean, streakCount: number, nextStreakMilestone: { days: number; title: string } | null } | null>(null);
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [achievementAlert, setAchievementAlert] = useState<Achievement | null>(null);

  // プレイヤー登録：登録した名前をニックネーム付きキャラが呼んでくれる。
  const [playerName, setPlayerName] = useState<string>(() => localStorage.getItem('playerName') || '');
  // 未登録なら初回起動時に登録モーダルを開く。登録済みでも編集用に開ける。
  const [showPlayerModal, setShowPlayerModal] = useState<boolean>(() => !localStorage.getItem('playerName'));
  const [playerNameDraft, setPlayerNameDraft] = useState('');

  // キャラのおしゃべり（吹き出し）：ニックネーム付きキャラの中から1体が交代でしゃべる。
  const [talkingMuscle, setTalkingMuscle] = useState<MuscleType | null>(null);
  const [talkingLine, setTalkingLine] = useState('');

  useEffect(() => {
    const now = Date.now();
    let hasChanges = false;
    const newStats = { ...stats };
    const droppedMuscles: string[] = [];

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
            const cur = mStat.condition ?? DEFAULT_CONDITION;
            const next = Math.max(0, cur - lost);
            if (next !== cur) {
              mStat.condition = next;
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
    localStorage.setItem('proteinLogs', JSON.stringify(proteinLogs));
  }, [proteinLogs]);

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

  useEffect(() => {
    if (playerName) localStorage.setItem('playerName', playerName);
  }, [playerName]);

  // ニックネーム付きキャラのおしゃべり（吹き出し）を一定間隔で交代させる。
  // ニックネームが1つも無ければ誰も話さない。セリフはコンディション・レベルで変化する。
  useEffect(() => {
    const nicknamed = (Object.keys(stats) as MuscleType[]).filter(m => stats[m].nickname);
    if (nicknamed.length === 0) {
      setTalkingMuscle(null);
      setTalkingLine('');
      return;
    }
    const speak = () => {
      const muscle = nicknamed[Math.floor(Math.random() * nicknamed.length)];
      const line = pickCharacterLine(muscle, stats[muscle], {
        playerName,
        isRecovering: checkIsRecovering(muscle, stats),
        isSuperComp: checkIsSuperComp(muscle, stats),
      });
      setTalkingMuscle(muscle);
      setTalkingLine(line);
    };
    speak();
    const interval = setInterval(speak, 7000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, playerName]);

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

        // コンディションによる補正。中立50を境に、調子が良ければ獲得EXPが増え（ボーナス）、
        // 過去の育成ミス（過剰トレ・サボり）で落ちていれば減る（ペナルティ、マイナスにはならない）。
        // 今回の記録前のコンディションで判定する＝「前回までの積み重ねが今回に効く」仕組み。
        const currentCondition = current.condition ?? DEFAULT_CONDITION;
        const conditionTier = getConditionTier(currentCondition);
        const isConditionBonus = conditionTier.multiplier > 1;
        const isPoorCondition = conditionTier.multiplier < 1;
        if (conditionTier.multiplier !== 1) {
          expToAdd = Math.max(1, Math.floor(expToAdd * conditionTier.multiplier));
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
          isConditionBonus,
          conditionMultiplier: conditionTier.multiplier,
          conditionLabel: conditionTier.multiplier !== 1 ? conditionTier.label : undefined,
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
      const isToday = d.getTime() === today.getTime();

      calendarData.push({
        date: dateStr,
        count: exp,
        level: level,
        isFuture: isFuture,
        isCurrentMonth: isCurrentMonth,
        isToday: isToday
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
            aria-label="前の月"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem', background: 'rgba(255,255,255,0.1)', minHeight: 'auto' }}
          >
            ◀︎
          </button>
          <div style={{ color: 'var(--text-accent)', fontSize: '1.1rem', fontWeight: 'bold' }}>
            {year}年 {month + 1}月
          </div>
          <button
            onClick={() => setCurrentMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
            aria-label="次の月"
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
                // トレーニングした日にはスタンプ（💪）を押す。手押しっぽく見えるよう日付から傾きを決定
                const isStamped = item.level > 0 && !item.isFuture;
                const stampRotate = (Number(item.date.slice(-2)) % 5) * 7 - 14; // -14〜+14度

                return (
                  <div
                    key={item.date}
                    data-tooltip-id="calendar-tooltip"
                    data-tooltip-content={`${item.date}${item.isToday ? '（今日）' : ''}: ${item.count} EXP獲得${isStamped ? '（スタンプ済 💪）' : ''}`}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '22px',
                      height: '22px',
                      borderRadius: '4px',
                      backgroundColor: item.isFuture ? 'rgba(255,255,255,0.02)' : colors[item.level],
                      opacity: opacity,
                      boxShadow: item.isToday
                        ? '0 0 6px rgba(0, 255, 255, 0.7)'
                        : item.level > 0 && !item.isFuture && item.isCurrentMonth ? `0 0 3px ${colors[item.level]}80` : 'none',
                      // 今日のマスはシアン枠で強調して現在位置をわかりやすくする
                      border: item.isToday
                        ? '1px solid var(--border-highlight)'
                        : item.isFuture ? '1px dashed rgba(255,255,255,0.1)' : 'none'
                    }}
                  >
                    {isStamped && (
                      <span
                        style={{
                          ['--stamp-rot' as string]: `${stampRotate}deg`,
                          fontSize: '14px',
                          lineHeight: 1,
                          transform: `rotate(${stampRotate}deg)`,
                          // 押印したてのスタンプ感を出すためのポップアニメーション（今日のみ）
                          animation: item.isToday ? 'stampPop 0.4s ease-out' : 'none',
                          filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.6))',
                          userSelect: 'none',
                          pointerEvents: 'none',
                        }}
                      >
                        💪
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* 凡例：スタンプ＝トレーニング実施日 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <span style={{ fontSize: '1rem' }}>💪</span>
          <span>トレーニングを実施した日はスタンプが押されます</span>
        </div>

        <Tooltip id="calendar-tooltip" />
      </div>
    );
  };
  const handleDrinkProtein = () => {
    let appliedGoldenCount = 0;
    let appliedNormalCount = 0;

    // 飲んだ事実を履歴に残す（ボーナスの有無に関わらず記録）
    setProteinLogs(prev => [Date.now(), ...prev]);

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

    let msg = "🥤 プロテインを飲みました！\n";
    if (appliedGoldenCount > 0) msg += `${appliedGoldenCount}箇所の筋肉にゴールデンタイムボーナス（次回EXP1.5倍）が適用されました！\n`;
    if (appliedNormalCount > 0) msg += `${appliedNormalCount}箇所の筋肉に通常プロテインボーナス（次回EXP1.3倍）が適用されました！`;
    alert(msg.trim());
  };

  // ニックネームの上限文字数。長すぎるとカードのレイアウトが崩れるため制限する
  const NICKNAME_MAX_LENGTH = 12;

  // キャラ（部位モンスター）のニックネームを保存する。空文字ならニックネームを解除（部位名に戻す）。
  const handleSaveNickname = (muscle: MuscleType) => {
    const trimmed = nicknameDraft.trim().slice(0, NICKNAME_MAX_LENGTH);
    setStats(prev => {
      const current = prev[muscle];
      const next = { ...current };
      if (trimmed) next.nickname = trimmed;
      else delete next.nickname;
      return { ...prev, [muscle]: next };
    });
    setEditingNickname(false);
  };

  // プレイヤー名を登録・変更する。空文字は登録扱いにしない（名前が無いとキャラが呼べないため）。
  const handleSavePlayerName = () => {
    const trimmed = playerNameDraft.trim().slice(0, PLAYER_NAME_MAX_LENGTH);
    if (!trimmed) return;
    setPlayerName(trimmed);
    setShowPlayerModal(false);
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

  // 履歴タブの「日別まとめ」用データ。
  // 日ごとに、鍛えた部位（セット数・獲得EXP）とプロテインを飲んだ回数を集計する。
  const historyByDay = useMemo(() => {
    const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土'];
    const keyOf = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // 日付キー → プロテインを飲んだ回数
    const proteinByDay: Record<string, number> = {};
    proteinLogs.forEach(ts => {
      const k = keyOf(ts);
      proteinByDay[k] = (proteinByDay[k] || 0) + 1;
    });

    interface MuscleSummary { muscle: MuscleType; sets: number; exp: number; }
    interface DayGroup {
      key: string;
      label: string;      // 表示用（例: 7/6(月)）
      logs: TrainingLog[];
      muscles: MuscleSummary[];
      proteinCount: number;
    }

    const order: string[] = [];
    const map: Record<string, { logs: TrainingLog[]; muscleAgg: Record<string, MuscleSummary> }> = {};

    // trainingLogs は新しい順。順序を保ったまま日ごとにまとめる。
    trainingLogs.forEach(log => {
      const k = keyOf(log.timestamp);
      if (!map[k]) {
        map[k] = { logs: [], muscleAgg: {} };
        order.push(k);
      }
      map[k].logs.push(log);

      const ex = EXERCISE_BY_NAME[log.exerciseName];
      if (ex) {
        const totalRatio = ex.targets.reduce((s, t) => s + t.expRatio, 0) || 1;
        ex.targets.forEach(t => {
          if (!map[k].muscleAgg[t.muscle]) {
            map[k].muscleAgg[t.muscle] = { muscle: t.muscle, sets: 0, exp: 0 };
          }
          map[k].muscleAgg[t.muscle].sets += log.sets;
          // 記録には合計EXPしか残っていないため、EXP比率で部位ごとに按分する（概算）。
          map[k].muscleAgg[t.muscle].exp += Math.round(log.gainedExp * t.expRatio / totalRatio);
        });
      }
    });

    // プロテインだけ飲んでトレーニングしていない日も表示できるように取り込む
    Object.keys(proteinByDay).forEach(k => {
      if (!map[k]) {
        map[k] = { logs: [], muscleAgg: {} };
        order.push(k);
      }
    });

    // 新しい日付が上に来るように並べ替え
    order.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    const groups: DayGroup[] = order.map(k => {
      const [y, mo, da] = k.split('-').map(Number);
      const wd = WEEKDAY_JP[new Date(y, mo - 1, da).getDay()];
      const muscles = Object.values(map[k].muscleAgg).sort((a, b) => b.sets - a.sets);
      return {
        key: k,
        label: `${mo}/${da}(${wd})`,
        logs: map[k].logs,
        muscles,
        proteinCount: proteinByDay[k] || 0,
      };
    });

    return groups;
  }, [trainingLogs, proteinLogs]);

  // 履歴タブの「表形式」用データ。縦＝キャラクター(部位)、横＝日。
  // 各セルにその日その部位のセット数・獲得EXP・種目を持たせ、行末に日ごとのプロテイン有無を持つ。
  const historyMatrix = useMemo(() => {
    const keyOf = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土'];

    interface Cell { sets: number; exp: number; exercises: { name: string; sets: number }[]; }
    // 日付キー → 部位キー → Cell
    const cells: Record<string, Record<string, Cell>> = {};
    const daySet = new Set<string>();
    const trainedMuscles = new Set<MuscleType>();

    trainingLogs.forEach(log => {
      const dk = keyOf(log.timestamp);
      daySet.add(dk);
      if (!cells[dk]) cells[dk] = {};
      const ex = EXERCISE_BY_NAME[log.exerciseName];
      if (!ex) return;
      const totalRatio = ex.targets.reduce((s, t) => s + t.expRatio, 0) || 1;
      ex.targets.forEach(t => {
        trainedMuscles.add(t.muscle);
        if (!cells[dk][t.muscle]) cells[dk][t.muscle] = { sets: 0, exp: 0, exercises: [] };
        const cell = cells[dk][t.muscle];
        cell.sets += log.sets;
        cell.exp += Math.round(log.gainedExp * t.expRatio / totalRatio);
        const found = cell.exercises.find(e => e.name === log.exerciseName);
        if (found) found.sets += log.sets;
        else cell.exercises.push({ name: log.exerciseName, sets: log.sets });
      });
    });

    // 日ごとのプロテイン摂取回数
    const proteinByDay: Record<string, number> = {};
    proteinLogs.forEach(ts => {
      const dk = keyOf(ts);
      daySet.add(dk);
      proteinByDay[dk] = (proteinByDay[dk] || 0) + 1;
    });

    // 日付列（新しい日が左）
    const days = Array.from(daySet)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
      .map(k => {
        const [y, mo, da] = k.split('-').map(Number);
        return { key: k, label: `${mo}/${da}`, weekday: WEEKDAY_JP[new Date(y, mo - 1, da).getDay()], protein: proteinByDay[k] || 0 };
      });

    // 行（部位）：MUSCLE_GROUPS の並び順で、1回でも鍛えたことのある部位だけ
    const muscles: MuscleType[] = [];
    MUSCLE_GROUPS.forEach(g => g.muscles.forEach(m => { if (trainedMuscles.has(m)) muscles.push(m); }));

    // セル強度の基準（最大セット数）
    let maxSets = 1;
    Object.values(cells).forEach(row => Object.values(row).forEach(c => { if (c.sets > maxSets) maxSets = c.sets; }));

    return { days, muscles, cells, maxSets };
  }, [trainingLogs, proteinLogs]);

  // 履歴タブの「表形式」の描画。縦＝部位、横＝日。セルはセット数（濃淡）＋タップで詳細。
  const renderHistoryMatrix = () => {
    const { days, muscles, cells, maxSets } = historyMatrix;
    const colors = ['#161b22', '#053b16', '#0b752b', '#1dd354', '#39ff14'];
    const setsToLevel = (sets: number) => {
      if (sets <= 0) return 0;
      const frac = sets / maxSets;
      if (frac >= 0.75) return 4;
      if (frac >= 0.5) return 3;
      if (frac >= 0.25) return 2;
      return 1;
    };

    // 共通セルスタイル
    const stickyLeft: React.CSSProperties = {
      position: 'sticky', left: 0, zIndex: 2,
      background: '#12151c', borderRight: '1px solid rgba(255,255,255,0.12)',
    };
    const th: React.CSSProperties = {
      padding: '5px 4px', fontSize: '0.7rem', color: 'var(--text-secondary)',
      fontWeight: 'normal', textAlign: 'center', whiteSpace: 'nowrap',
    };
    const cellSize = 34;

    return (
      <div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem' }}>
          数字はセット数。色が濃いほど多くこなした日。セルをタップで種目の詳細が見られます。
        </p>
        <div style={{ overflow: 'auto', maxHeight: '460px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={{ ...th, ...stickyLeft, zIndex: 4, top: 0, position: 'sticky', textAlign: 'left', paddingLeft: '8px', minWidth: '68px' }}>
                  部位＼日
                </th>
                {days.map(d => (
                  <th key={d.key} style={{ ...th, position: 'sticky', top: 0, zIndex: 1, background: '#12151c', minWidth: `${cellSize}px` }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{d.label}</div>
                    <div>({d.weekday})</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* プロテイン行 */}
              <tr>
                <th style={{ ...th, ...stickyLeft, textAlign: 'left', paddingLeft: '8px', color: '#ff7bff', fontWeight: 'bold' }}>
                  🥤 プロテイン
                </th>
                {days.map(d => (
                  <td
                    key={d.key}
                    data-tooltip-id="matrix-tooltip"
                    data-tooltip-content={d.protein > 0 ? `${d.label} プロテイン ${d.protein}回` : `${d.label} プロテインなし`}
                    style={{ textAlign: 'center', padding: '4px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.85rem' }}
                  >
                    {d.protein > 0 ? (d.protein > 1 ? `🥤×${d.protein}` : '🥤') : ''}
                  </td>
                ))}
              </tr>
              {/* 部位ごとの行 */}
              {muscles.map(m => (
                <tr key={m}>
                  <th style={{ ...th, ...stickyLeft, textAlign: 'left', paddingLeft: '8px', color: 'var(--text-primary)', fontSize: '0.75rem' }}>
                    {MUSCLE_NAMES[m]}
                  </th>
                  {days.map(d => {
                    const cell = cells[d.key]?.[m];
                    const level = cell ? setsToLevel(cell.sets) : 0;
                    const tip = cell
                      ? `${MUSCLE_NAMES[m]} ${d.label}｜${cell.exercises.map(e => `${e.name} ${e.sets}set`).join(' / ')}（+${cell.exp}EXP）`
                      : `${MUSCLE_NAMES[m]} ${d.label}｜記録なし`;
                    return (
                      <td
                        key={d.key}
                        data-tooltip-id="matrix-tooltip"
                        data-tooltip-content={tip}
                        style={{ padding: '3px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        <div style={{
                          width: `${cellSize - 8}px`, height: `${cellSize - 8}px`,
                          margin: '0 auto', borderRadius: '5px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: colors[level],
                          color: level >= 3 ? '#04210b' : (level > 0 ? '#d8ffe0' : 'transparent'),
                          fontSize: '0.72rem', fontWeight: 'bold',
                          boxShadow: level > 0 ? `0 0 3px ${colors[level]}80` : 'none',
                        }}>
                          {cell ? cell.sets : ''}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Tooltip id="matrix-tooltip" style={{ maxWidth: '260px', fontSize: '0.72rem', whiteSpace: 'normal', zIndex: 50 }} />
      </div>
    );
  };

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
  // 図鑑モーダルを開く。タップした形態（phase）と同じ進化の順番の画像を表示する。
  const openZukan = (muscle: MuscleType, phase: 1 | 2 | 3) => {
    setSelectedZukanMuscle(muscle);
    setSelectedZukanPhase(phase);
  };

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

        {/* 分岐進化タイプの共通解説（全筋肉共通なので図鑑トップに1ヵ所だけ集約。折りたたみ式） */}
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', marginBottom: '1.5rem', overflow: 'hidden' }}>
          <button
            onClick={() => setShowBranchGuide(v => !v)}
            aria-expanded={showBranchGuide}
            style={{
              width: '100%', background: 'none', border: 'none', cursor: 'pointer',
              padding: '0.9rem 1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              color: 'var(--text-primary)', font: 'inherit',
            }}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🧬</span> 分岐進化タイプとは？
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', transform: showBranchGuide ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
          </button>
          {showBranchGuide && (
            <div style={{ padding: '0 1.2rem 1.1rem' }}>
              <p style={{ fontSize: '0.8rem', lineHeight: '1.5', color: 'var(--text-secondary)', margin: '0 0 0.8rem' }}>
                第3形態（Lv.10）に到達すると、それまでのトレーニング傾向に応じて3つの「型」のいずれかに進化します。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {(Object.keys(BRANCH_INFO) as EvolutionBranch[]).map(b => {
                  const info = BRANCH_INFO[b];
                  return (
                    <div key={b} style={{ fontSize: '0.8rem', lineHeight: '1.5' }}>
                      <span style={{ color: info.color, fontWeight: 'bold' }}>{info.emoji} {info.label}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>：{info.description}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
                // 到達済みの最高フェーズ（カード全体タップ時のデフォルト表示に使う）
                const highestPhase: 1 | 2 | 3 = level >= 10 ? 3 : level >= 5 ? 2 : 1;

                return (
                  <div
                    key={muscle}
                    className="glass-panel"
                    onClick={() => openZukan(muscle, highestPhase)}
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
                            <div
                              onClick={e => { e.stopPropagation(); openZukan(muscle, phase); }}
                              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0, cursor: 'pointer' }}
                            >
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
    <div className="main-content" ref={mainContentRef}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        {selectedTitle && (
          <div style={{ color: '#ffea00', fontWeight: 'bold', fontSize: '1.2rem', marginBottom: '0.5rem', animation: 'float 3s ease-in-out infinite' }}>
            【{selectedTitle}】
          </div>
        )}
        <h1 style={{ color: 'var(--text-primary)', fontSize: 'clamp(1.7rem, 8vw, 2.5rem)', margin: '0' }}>マッスル<br />モンスターズ</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>筋トレで筋肉を育てよう！</p>
        {playerName && (
          <button
            onClick={() => { setPlayerNameDraft(playerName); setShowPlayerModal(true); }}
            style={{ marginTop: '0.6rem', padding: '0.3rem 0.8rem', fontSize: '0.8rem', background: 'transparent', color: 'var(--text-accent)', border: '1px solid var(--border-highlight)', borderRadius: '999px', cursor: 'pointer' }}
          >
            👤 {playerName} <span style={{ color: 'var(--text-secondary)' }}>✏️</span>
          </button>
        )}
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
                  const conditionTier = getConditionTier(mStats.condition ?? DEFAULT_CONDITION);
                  const showCondition = (mStats.lastTrainedAt || 0) > 0;

                  return (
                    <div 
                      key={muscle} 
                      className="glass-panel muscle-card"
                      onClick={() => { setShowTrainingPicker(false); setEditingNickname(false); setSelectedMuscleInfo(muscle); }}
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
                        data-tooltip-content={isTrainedToday ? '本日トレーニング済み！' : (mStats.nickname ? MUSCLE_NAMES[muscle] : undefined)}
                        style={{ fontSize: '0.8rem', marginBottom: '0.2rem', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {mStats.nickname || MUSCLE_NAMES[muscle]}
                      </h3>
                      {mStats.nickname && (
                        <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', margin: '-0.15rem 0 0.05rem', lineHeight: 1 }}>
                          {MUSCLE_NAMES[muscle]}
                        </span>
                      )}
                      <p style={{ color: 'var(--border-highlight)', margin: '0', fontSize: '0.8rem' }}>Lv.{mStats.level}</p>

                      {/* おしゃべり吹き出し：ニックネーム付きキャラが交代でプレイヤーに話しかける */}
                      {talkingMuscle === muscle && talkingLine && (
                        <div className="speech-bubble" key={talkingLine}>
                          {talkingLine}
                        </div>
                      )}

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
                            data-tooltip-content={`超回復ピーク！今鍛えると獲得EXP x${SUPERCOMP_BONUS}（${formatDate((mStats.lastTrainedAt || 0) + requiredRecoveryMs * CONDITION_SABORI_GRACE_FACTOR)}まで）`}
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
                              // ゴールデンタイムのみ黄。通常ボーナス・対象はシアンで統一し、緑（超回復ピーク⚡/本日トレ済み）との被りを避ける。
                              background: hasGoldenBonus ? 'rgba(255, 234, 0, 0.2)' : 'rgba(0, 255, 255, 0.2)',
                              padding: '2px', borderRadius: '50%', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px',
                              border: `1px solid ${hasGoldenBonus ? 'rgba(255, 234, 0, 0.5)' : 'rgba(0, 255, 255, 0.5)'}`,
                              animation: isProteinTarget ? 'pulse 1.5s infinite' : 'float 2s ease-in-out infinite'
                            }}
                          >
                            {(hasGoldenBonus || hasNormalBonus) ? '✨' : '🥤'}
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

                      {/* コンディションゲージ */}
                      {showCondition && (
                        <div
                          style={{ width: '100%', marginTop: '0.5rem' }}
                          data-tooltip-id="calendar-tooltip"
                          data-tooltip-content={`コンディション: ${conditionTier.label}${conditionTier.multiplier !== 1 ? `（次回EXP x${conditionTier.multiplier}）` : ''}｜中立50`}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
                            <span style={{ color: conditionTier.color }}>調子 {conditionTier.emoji}</span>
                            <span style={{ color: conditionTier.color }}>{mStats.condition ?? DEFAULT_CONDITION}/{MAX_CONDITION}</span>
                          </div>
                          <div style={{ position: 'relative', width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${mStats.condition ?? DEFAULT_CONDITION}%`, height: '100%', background: conditionTier.color, transition: 'width 0.5s ease-out' }} />
                            {/* 中立点(50)マーカー：これより右がボーナス、左がペナルティ */}
                            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${DEFAULT_CONDITION}%`, width: '1px', background: 'rgba(255,255,255,0.5)' }} />
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
                inputMode="decimal"
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
                  <input type="number" min="0" inputMode="decimal" value={weight} onChange={e => setWeight(Number(e.target.value) || '')} placeholder="0" required style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.2rem', padding: '1rem 0' }} />
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.9rem', textAlign: 'center' }}>回数/秒数</label>
                <input type="number" min="1" inputMode="numeric" value={reps} onChange={e => setReps(Number(e.target.value) || '')} required style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.2rem', padding: '1rem 0' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.9rem', textAlign: 'center' }}>セット数</label>
                <input type="number" min="1" inputMode="numeric" value={sets} onChange={e => setSets(Number(e.target.value) || '')} required style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.2rem', padding: '1rem 0' }} />
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

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '1.2rem', margin: 0 }}>日別の記録</h3>
            {/* 一覧 / 表 の切り替え */}
            <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.3)', borderRadius: '10px', padding: '3px' }}>
              {([['list', '📋 一覧'], ['matrix', '📊 表']] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setLogView(v)}
                  style={{
                    padding: '5px 12px',
                    fontSize: '0.8rem',
                    minHeight: 'auto',
                    borderRadius: '8px',
                    background: logView === v ? 'var(--text-accent)' : 'transparent',
                    color: logView === v ? '#000' : 'var(--text-secondary)',
                    fontWeight: logView === v ? 'bold' : 'normal',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {historyByDay.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>まだ記録がありません。トレーニングを開始しましょう！</p>
          ) : logView === 'matrix' ? (
            renderHistoryMatrix()
          ) : (
            <div style={{ maxHeight: '460px', overflowY: 'auto', paddingRight: '10px' }}>
              {historyByDay.map(day => (
                <div key={day.key} style={{ marginBottom: '1.5rem' }}>
                  {/* 日付ヘッダー ＋ プロテインの有無 */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    marginBottom: '0.6rem',
                    paddingBottom: '0.3rem',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                  }}>
                    <span style={{ fontSize: '1.05rem', fontWeight: 'bold', color: 'var(--text-accent)' }}>
                      📅 {day.label}
                    </span>
                    {day.proteinCount > 0 && (
                      <span style={{
                        background: 'rgba(255, 0, 255, 0.12)',
                        border: '1px solid rgba(255, 0, 255, 0.4)',
                        color: '#ff7bff',
                        padding: '3px 10px',
                        borderRadius: '14px',
                        fontSize: '0.8rem',
                        fontWeight: 'bold',
                      }}>
                        🥤 プロテイン{day.proteinCount > 1 ? ` ×${day.proteinCount}` : ''}
                      </span>
                    )}
                  </div>

                  {/* その日に鍛えた部位のサマリー（セット数・獲得EXP） */}
                  {day.muscles.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '0.7rem' }}>
                      {day.muscles.map(m => (
                        <span key={m.muscle} style={{
                          display: 'inline-flex',
                          alignItems: 'baseline',
                          gap: '5px',
                          background: 'rgba(0,255,255,0.08)',
                          border: '1px solid rgba(0,255,255,0.25)',
                          borderRadius: '14px',
                          padding: '3px 10px',
                          fontSize: '0.8rem',
                        }}>
                          <span style={{ color: 'var(--text-primary)' }}>{MUSCLE_NAMES[m.muscle]}</span>
                          <b style={{ color: '#00ffff' }}>{m.sets}set</b>
                          <span style={{ color: 'var(--text-accent)', fontSize: '0.72rem' }}>+{m.exp}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 個別のトレーニングログ */}
                  {day.logs.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
                      この日はトレーニング記録なし
                    </p>
                  ) : (
                    day.logs.map(log => {
                      const t = new Date(log.timestamp);
                      const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
                      return (
                        <div key={log.id} style={{
                          background: 'rgba(255,255,255,0.05)',
                          padding: '0.8rem 1rem',
                          borderRadius: '8px',
                          marginBottom: '0.6rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '0.5rem'
                        }}>
                          <div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              {time}
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: 'var(--text-accent)' }}>
                              {log.exerciseName}
                            </div>
                            <div style={{ fontSize: '0.92rem', marginTop: '2px' }}>
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
                      );
                    })
                  )}
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

      {/* プレイヤー登録モーダル：未登録なら初回起動時に表示。登録した名前をキャラが呼んでくれる */}
      {showPlayerModal && (
        <div className="modal-overlay" style={{ zIndex: 1003 }} onClick={() => { if (playerName) setShowPlayerModal(false); }}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', animation: 'scaleIn 0.3s ease-out', maxWidth: '360px', width: '90%' }}>
            <h1 style={{ color: 'var(--text-accent)', fontSize: '1.6rem', marginBottom: '0.5rem' }}>👤 プレイヤー登録</h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.2rem', lineHeight: 1.6 }}>
              あなたの名前を登録しよう！<br />
              ニックネームを付けた筋肉モンスターが、この名前で話しかけてくれるよ。
            </p>
            <input
              type="text"
              value={playerNameDraft}
              maxLength={PLAYER_NAME_MAX_LENGTH}
              autoFocus
              placeholder="プレイヤー名を入力"
              onChange={e => setPlayerNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSavePlayerName(); }}
              style={{
                width: '100%', padding: '0.7rem 0.8rem', fontSize: '1rem', textAlign: 'center',
                background: 'rgba(0,0,0,0.35)', color: 'var(--text-primary)',
                border: '1px solid var(--border-highlight)', borderRadius: '8px', marginBottom: '1.2rem'
              }}
            />
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center' }}>
              <button
                onClick={handleSavePlayerName}
                disabled={!playerNameDraft.trim()}
                style={{ flex: 1, padding: '0.7rem', fontSize: '1rem', fontWeight: 'bold', background: playerNameDraft.trim() ? 'var(--text-accent)' : 'rgba(255,255,255,0.15)', color: playerNameDraft.trim() ? '#000' : 'var(--text-secondary)', border: 'none', borderRadius: '8px', cursor: playerNameDraft.trim() ? 'pointer' : 'not-allowed' }}
              >
                {playerName ? '変更する' : '登録する'}
              </button>
              {playerName && (
                <button
                  onClick={() => setShowPlayerModal(false)}
                  style={{ flexShrink: 0, padding: '0.7rem 1rem', fontSize: '0.9rem', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', cursor: 'pointer' }}
                >
                  キャンセル
                </button>
              )}
            </div>
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
        <div className="modal-overlay" onClick={() => { setShowTrainingPicker(false); setEditingNickname(false); setSelectedMuscleInfo(null); }}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ textAlign: 'left', animation: 'scaleIn 0.3s ease-out', maxWidth: '400px', width: '90%', padding: '1.5rem', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.15rem', letterSpacing: '0.05em' }}>{MUSCLE_READINGS[selectedMuscleInfo]}</span>
                  {stats[selectedMuscleInfo].nickname ? (
                    <>
                      <h2 style={{ color: 'var(--text-accent)', margin: 0, fontSize: '1.4rem', wordBreak: 'break-word' }}>{stats[selectedMuscleInfo].nickname}</h2>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{MUSCLE_NAMES[selectedMuscleInfo]}</span>
                    </>
                  ) : (
                    <h2 style={{ color: 'var(--text-accent)', margin: 0, fontSize: '1.4rem' }}>{MUSCLE_NAMES[selectedMuscleInfo]}</h2>
                  )}
                </div>
                <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', flexShrink: 0, marginLeft: '0.5rem' }}>Lv.{stats[selectedMuscleInfo].level}</span>
              </div>

              {/* ニックネームの表示・編集。編集中はインプット、非編集時は付ける/変更ボタンを出す */}
              {editingNickname ? (
                <div style={{ marginTop: '0.6rem' }}>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={nicknameDraft}
                      maxLength={NICKNAME_MAX_LENGTH}
                      autoFocus
                      placeholder={`例：${MUSCLE_NICKNAME_SAMPLES[selectedMuscleInfo]}`}
                      onChange={e => setNicknameDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveNickname(selectedMuscleInfo); }}
                      style={{
                        flex: 1, minWidth: 0, padding: '0.4rem 0.6rem', fontSize: '0.9rem',
                        background: 'rgba(0,0,0,0.35)', color: 'var(--text-primary)',
                        border: '1px solid var(--border-highlight)', borderRadius: '6px'
                      }}
                    />
                    <button
                      onClick={() => handleSaveNickname(selectedMuscleInfo)}
                      style={{ flexShrink: 0, padding: '0.4rem 0.7rem', fontSize: '0.85rem', fontWeight: 'bold', background: 'var(--text-accent)', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditingNickname(false)}
                      style={{ flexShrink: 0, padding: '0.4rem 0.6rem', fontSize: '0.85rem', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setNicknameDraft(stats[selectedMuscleInfo].nickname || ''); setEditingNickname(true); }}
                  style={{ marginTop: '0.5rem', padding: '0.35rem 0.7rem', fontSize: '0.8rem', background: 'transparent', color: 'var(--text-accent)', border: '1px solid var(--border-highlight)', borderRadius: '6px', cursor: 'pointer' }}
                >
                  ✏️ {stats[selectedMuscleInfo].nickname ? 'ニックネームを変更' : 'ニックネームを付ける'}
                </button>
              )}
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

            {/* 現在の状態：カード上のアイコンが示す「今この筋肉がどんな状態か」を、
                同じ絵文字を並べて一覧で説明する。カードのアイコン⇔意味の対応表として機能する。 */}
            <div style={{ marginBottom: '1.2rem' }}>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-accent)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>🔎</span> 現在の状態
              </h4>
              {(() => {
                const mStats = stats[selectedMuscleInfo];
                const requiredRecoveryMs = MUSCLE_RECOVERY_HOURS[selectedMuscleInfo] * 60 * 60 * 1000;
                const timeSinceLastTraining = Date.now() - (mStats.lastTrainedAt || 0);
                const hasTrained = (mStats.lastTrainedAt || 0) > 0;
                const isTrainedToday = hasTrained && new Date(mStats.lastTrainedAt!).toDateString() === new Date().toDateString();
                const isRecovering = checkIsRecovering(selectedMuscleInfo, stats);
                const isSuperCompReady = checkIsSuperComp(selectedMuscleInfo, stats);
                const isProteinTarget = hasTrained && timeSinceLastTraining <= 2 * 60 * 60 * 1000 && !mStats.proteinBonusMultiplier && !mStats.hasProteinBonus;
                const hasGoldenBonus = mStats.proteinBonusMultiplier === 1.5;
                const hasNormalBonus = mStats.proteinBonusMultiplier === 1.3 || mStats.hasProteinBonus;
                const branch = resolveBranch(mStats, selectedMuscleInfo, trainingLogs);
                const branchInfo = branch ? BRANCH_INFO[branch] : null;

                const items: { emoji: string; label: string; color: string; desc: string }[] = [];

                if (isTrainedToday) {
                  items.push({ emoji: '💪', label: '本日トレーニング済み', color: '#39ff14', desc: '今日この部位を鍛えました。カードが緑色に光ります。' });
                }
                if (isRecovering) {
                  const remainingHours = Math.ceil((requiredRecoveryMs - timeSinceLastTraining) / (60 * 60 * 1000));
                  items.push({ emoji: '💤', label: '休息中', color: 'orange', desc: `超回復まであと約${remainingHours}時間。今鍛えると疲労で獲得EXPが半減します。` });
                }
                if (isSuperCompReady && !isTrainedToday) {
                  // 超回復ピークは 回復完了 ～ 回復時間×サボり係数 までの窓。
                  // この窓を過ぎるとサボり圏に入りボーナスが消えるので、期限を明示する。
                  const superCompEndsAt = mStats.lastTrainedAt! + requiredRecoveryMs * CONDITION_SABORI_GRACE_FACTOR;
                  const remainingHours = Math.max(1, Math.ceil((superCompEndsAt - Date.now()) / (60 * 60 * 1000)));
                  items.push({ emoji: '⚡', label: '超回復ピーク（狙い目）', color: '#39ff14', desc: `回復が完了した狙い目の状態。今鍛えると獲得EXPが x${SUPERCOMP_BONUS} になります。${formatDate(superCompEndsAt)}まで（あと約${remainingHours}時間）がボーナス期限。過ぎるとサボり扱いになります。` });
                }
                if (hasGoldenBonus) {
                  items.push({ emoji: '✨', label: 'ゴールデンタイム', color: '#ffea00', desc: '次回の獲得EXPが x1.5 になります（トレーニングで消費）。' });
                } else if (hasNormalBonus) {
                  items.push({ emoji: '✨', label: 'プロテインボーナス', color: '#00ffff', desc: '次回の獲得EXPが x1.3 になります（トレーニングで消費）。' });
                } else if (isProteinTarget) {
                  items.push({ emoji: '🥤', label: 'プロテイン対象', color: '#00ffff', desc: 'トレーニングから2時間以内。今プロテインを飲むと次回EXPにボーナスが付きます。' });
                }
                if (branchInfo) {
                  items.push({ emoji: branchInfo.emoji, label: `分岐進化: ${branchInfo.label}`, color: branchInfo.color, desc: branchInfo.description });
                }
                // 調子（コンディション）：カードの調子ゲージと同じ絵文字・ラベル・色で対応させる。
                // カードはトレーニング済みの部位で常にゲージを表示するので、ここでも同条件で並べる。
                if (hasTrained) {
                  const conditionTier = getConditionTier(mStats.condition ?? DEFAULT_CONDITION);
                  items.push({
                    emoji: conditionTier.emoji,
                    label: `調子: ${conditionTier.label}`,
                    color: conditionTier.color,
                    desc: conditionTier.multiplier > 1
                      ? `調子が絶好調！次回の獲得EXPが x${conditionTier.multiplier} になります。`
                      : conditionTier.multiplier < 1
                      ? `育成ミスで調子が低下中。次回の獲得EXPが x${conditionTier.multiplier} になります。`
                      : '調子は中立（50）。上がるとボーナス、下がるとペナルティになります。',
                  });
                }

                if (items.length === 0) {
                  return (
                    <p style={{ fontSize: '0.83rem', lineHeight: 1.5, margin: 0, color: 'var(--text-secondary)' }}>
                      まだトレーニング記録がありません。記録すると状態が表示されます。
                    </p>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {items.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                        <span style={{
                          flexShrink: 0, width: '28px', height: '28px', borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                          background: 'rgba(0,0,0,0.3)', border: `1px solid ${item.color}`,
                          filter: `drop-shadow(0 0 2px ${item.color})`
                        }}>
                          {item.emoji}
                        </span>
                        <div style={{ flex: 1 }}>
                          <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: item.color, lineHeight: 1.3 }}>{item.label}</span>
                          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{item.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div style={{ marginBottom: '1.2rem' }}>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-accent)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>🕒</span> 最後にトレーニングした日時
              </h4>
              <div style={{ fontSize: '0.85rem', lineHeight: '1.5', margin: 0 }}>
                {(() => {
                  const mStats = stats[selectedMuscleInfo];
                  if (!mStats.lastTrainedAt) return <span style={{ color: 'var(--text-secondary)' }}>トレーニング記録なし</span>;
                  return <span>{formatDate(mStats.lastTrainedAt)}</span>;
                })()}
              </div>
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', margin: '0 0 1.2rem', lineHeight: 1.5 }}>
              📚 筋肉の解説・おすすめ種目・Tips は<strong style={{ color: 'var(--text-accent)' }}>図鑑</strong>で確認できます
            </p>

            {/* この部位を鍛える：記録タブへ遷移し種目を事前選択する。
                対応する種目が複数ある場合は、まず種目の選択肢を提示する。
                主対象の種目が無い場合は補助的に含む種目へフォールバックする。 */}
            {(() => {
              const muscle = selectedMuscleInfo;
              const primaryExercises = EXERCISES.filter(ex => ex.primaryMuscle === muscle);
              const candidateExercises = primaryExercises.length > 0
                ? primaryExercises
                : EXERCISES.filter(ex => ex.targets.some(t => t.muscle === muscle));

              const goToRecord = (exerciseId: string) => {
                setSelectedExerciseId(exerciseId);
                setShowTrainingPicker(false);
                setEditingNickname(false);
                setSelectedMuscleInfo(null);
                setActiveTab('record');
              };

              if (candidateExercises.length === 0) return null;

              if (showTrainingPicker && candidateExercises.length > 1) {
                return (
                  <div style={{ marginBottom: '0.6rem' }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-accent)', margin: '0 0 0.6rem', textAlign: 'center', fontWeight: 'bold' }}>
                      🏋️ 記録する種目を選ぶ
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {candidateExercises.map(ex => (
                        <button
                          key={ex.id}
                          onClick={() => goToRecord(ex.id)}
                          style={{ width: '100%', padding: '0.8rem', textTransform: 'none', textAlign: 'center', border: '1px solid #39ff14' }}
                        >
                          {ex.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              return (
                <button
                  onClick={() => {
                    if (candidateExercises.length === 1) {
                      goToRecord(candidateExercises[0].id);
                    } else {
                      setShowTrainingPicker(true);
                    }
                  }}
                  style={{
                    width: '100%', padding: '1rem', marginBottom: '0.6rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    background: 'var(--btn-hover-bg)', color: 'var(--btn-hover-text)',
                    border: '1px solid #39ff14', fontWeight: 'bold'
                  }}
                >
                  🏋️ この部位を鍛える
                </button>
              );
            })()}

            <button onClick={() => { setShowTrainingPicker(false); setEditingNickname(false); setSelectedMuscleInfo(null); }} style={{ width: '100%', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>閉じる</button>
          </div>
        </div>
      )}

      {/* 図鑑の筋肉詳細モーダル：育成状況に依らない静的な情報（説明・おすすめ種目・Tips・分岐進化タイプ）を表示する */}
      {selectedZukanMuscle && (
        <div className="modal-overlay" onClick={() => setSelectedZukanMuscle(null)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ textAlign: 'left', animation: 'scaleIn 0.3s ease-out', maxWidth: '400px', width: '90%', padding: 0, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            {/* ヘッダー：スクロールしても常に見えるよう固定 */}
            <div style={{ flexShrink: 0, padding: '1.25rem 1.5rem 0.9rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.15rem', letterSpacing: '0.05em' }}>{MUSCLE_READINGS[selectedZukanMuscle]}</span>
                  <h2 style={{ color: 'var(--text-accent)', margin: 0, fontSize: '1.4rem' }}>{MUSCLE_NAMES[selectedZukanMuscle]}</h2>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>📚 図鑑</span>
              </div>
            </div>

            {/* 本文：ここだけスクロールさせて、上下の見切れ・閉じるボタンの埋没を防ぐ */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>

            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              {(() => {
                const zLevel = stats[selectedZukanMuscle].level;
                const pInfo = PHASE_INFO[selectedZukanPhase];
                const discovered = zLevel >= pInfo.unlockLevel;
                const zBranch = selectedZukanPhase === 3 && discovered
                  ? resolveBranch(stats[selectedZukanMuscle], selectedZukanMuscle, trainingLogs)
                  : undefined;
                const zBranchInfo = zBranch ? BRANCH_INFO[zBranch] : null;
                return (
                  <>
                    <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                      <img
                        src={getSpriteSrc(selectedZukanMuscle, selectedZukanPhase, zBranch)}
                        onError={e => handleSpriteError(e, selectedZukanMuscle)}
                        alt={discovered ? `${MUSCLE_NAMES[selectedZukanMuscle]} ${pInfo.label}` : '未発見'}
                        style={{
                          height: '120px', objectFit: 'contain',
                          filter: discovered
                            ? (zBranchInfo ? `drop-shadow(0 0 8px ${zBranchInfo.color})` : 'none')
                            : 'brightness(0) drop-shadow(0 0 1px rgba(255,255,255,0.45))',
                          opacity: discovered ? 1 : 0.55,
                        }}
                      />
                      {!discovered && (
                        <span style={{ position: 'absolute', fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>？</span>
                      )}
                    </div>
                    <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-accent)' }}>
                      {pInfo.label}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: zBranchInfo ? zBranchInfo.color : 'var(--text-secondary)' }}>
                      {discovered ? (zBranchInfo ? `${zBranchInfo.emoji} ${zBranchInfo.label}` : pInfo.stage) : `Lv.${pInfo.unlockLevel}で解放`}
                    </div>
                    <div style={{ marginTop: '0.6rem', display: 'inline-block', fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '999px', padding: '0.2rem 0.7rem' }}>
                      💤 超回復 {MUSCLE_RECOVERY_HOURS[selectedZukanMuscle]}時間ごと
                    </div>
                  </>
                );
              })()}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-accent)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>📖</span> 概要
              </h4>
              <p style={{ fontSize: '0.85rem', lineHeight: '1.5', margin: 0 }}>
                {MUSCLE_DETAILS[selectedZukanMuscle].description}
              </p>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-accent)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>🏋️</span> おすすめトレーニング
              </h4>
              <ul style={{ fontSize: '0.85rem', paddingLeft: '1.5rem', lineHeight: '1.5', margin: 0 }}>
                {MUSCLE_DETAILS[selectedZukanMuscle].effectiveExercises.map(ex => (
                  <li key={ex}>{ex}</li>
                ))}
              </ul>
            </div>

            <div style={{ background: 'rgba(255,234,0,0.1)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #ffea00' }}>
              <h4 style={{ fontSize: '0.9rem', color: '#ffea00', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>💡</span> Tips
              </h4>
              <p style={{ fontSize: '0.8rem', lineHeight: '1.5', margin: 0 }}>
                {MUSCLE_DETAILS[selectedZukanMuscle].trivia}
              </p>
            </div>

            </div>{/* /本文スクロール領域 */}

            {/* フッター：閉じるボタンは常に見えるよう固定 */}
            <div style={{ flexShrink: 0, padding: '0.9rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <button onClick={() => setSelectedZukanMuscle(null)} style={{ width: '100%', padding: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Navigation Tabs - Moved outside main wrapper to prevent z-index / fixed positioning issues */}
    <div className="tab-container">
      {([
        ['characters', '👾', 'マスモン'],
        ['record', '🏋️', '記録'],
        ['logs', '📖', '履歴'],
        ['achievements', '🏆', '実績'],
        ['encyclopedia', '📚', '図鑑'],
      ] as const).map(([tab, icon, label]) => (
        <button
          key={tab}
          className={`tab-button ${activeTab === tab ? 'active' : ''}`}
          onClick={() => setActiveTab(tab)}
          aria-current={activeTab === tab ? 'page' : undefined}
        >
          <span className="tab-icon" aria-hidden="true">{icon}</span>
          <span className="tab-label">{label}</span>
        </button>
      ))}
    </div>
    </>
  );
}

export default App;
