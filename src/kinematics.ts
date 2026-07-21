export interface KinematicsResult {
  nRevLeft: number;
  timeLeft: number;
  sector: number;
  direction: 'CW' | 'CCW';
}

const T_DROP = 1.3;
const DECAY_RATE = 0.04;
const SCATTER_POCKETS = 10;
const POCKET_ANGLE = 360.0 / 37.0;

export function calculateKinematics(ticks: number[], direction: 'CW' | 'CCW'): KinematicsResult | null {
  const [t_r1, t_r2, t_b1, t_b2] = ticks;
  
  // 초 단위 변환
  const t_r = (t_r2 - t_r1) / 1000.0;
  const t_b = (t_b2 - t_b1) / 1000.0;

  if (t_b >= T_DROP) return null;

  const nRevLeft = (T_DROP - t_b) / DECAY_RATE;
  const timeLeft = nRevLeft * ((t_b + T_DROP) / 2.0);

  const timeSinceRotorZero = (t_b2 - t_r2) / 1000.0;
  const rotorInitialAngle = (timeSinceRotorZero / t_r * 360.0) % 360.0;

  let ballDropAngle;
  if (direction === 'CCW') {
    ballDropAngle = (-nRevLeft * 360.0) % 360.0;
  } else {
    ballDropAngle = (nRevLeft * 360.0) % 360.0;
  }

  const rotorDropAngle = (rotorInitialAngle + (timeLeft / t_r * 360.0)) % 360.0;
  
  let relativeLandingAngle = (ballDropAngle - rotorDropAngle) % 360.0;
  if (relativeLandingAngle < 0) relativeLandingAngle += 360.0;

  let finalAngle;
  if (direction === 'CCW') {
    finalAngle = (relativeLandingAngle + (SCATTER_POCKETS * POCKET_ANGLE)) % 360.0;
  } else {
    finalAngle = (relativeLandingAngle - (SCATTER_POCKETS * POCKET_ANGLE)) % 360.0;
  }
  if (finalAngle < 0) finalAngle += 360.0;

  const sector = Math.floor(finalAngle / 45.0) + 1;

  return { nRevLeft, timeLeft, sector, direction };
}
