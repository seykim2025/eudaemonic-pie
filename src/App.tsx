import { useState, useRef } from 'react';
import './App.css';
import { calculateKinematics } from './kinematics';
import { waitForEvenAppBridge, TextContainerUpgrade } from '@evenrealities/even_hub_sdk';

const THRESHOLD = 0.010734; 
const COOLDOWN_TIME = 300;
const DOUBLE_TAP_WINDOW = 600;

type Phase = 'DIRECTION' | 'ROTOR' | 'BALL';

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [rms, setRms] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  
  const phaseRef = useRef<Phase>('DIRECTION');
  const dirRef = useRef<'CW' | 'CCW'>('CCW');
  const ticksRef = useRef<number[]>([]);
  const lastTickTimeRef = useRef<number>(0);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, msg].slice(-10));
  };

  // Even Hub SDK를 사용해 안경 HUD에 텍스트를 전송
  const sendToGlasses = async (text: string) => {
    try {
      const bridge = await waitForEvenAppBridge();
      const req = new TextContainerUpgrade({
         containerID: 1,
         content: text
      });
      await bridge.textContainerUpgrade(req);
    } catch (e) {
      // 로컬 개발/시뮬레이터 환경에서는 에러 없이 무시 (터미널에서만 확인)
    }
  };

  const handleTick = (now: number) => {
    lastTickTimeRef.current = now;
    
    if (phaseRef.current === 'DIRECTION') {
      ticksRef.current.push(now);
      if (ticksRef.current.length === 1) {
         addLog("[방향] 틱 감지! 싱글=↺, 더블=↻...");
         setTimeout(() => {
            if (phaseRef.current === 'DIRECTION' && ticksRef.current.length === 1) {
               dirRef.current = 'CCW';
               addLog(">> 방향 확정: 반시계 ↺");
               ticksRef.current = [Date.now()];
               phaseRef.current = 'ROTOR';
               sendToGlasses("•");
               addLog("[1] 틱 감지! >> [ • ]");
            }
         }, DOUBLE_TAP_WINDOW);
      } else if (ticksRef.current.length === 2) {
         const interval = ticksRef.current[1] - ticksRef.current[0];
         if (interval <= DOUBLE_TAP_WINDOW) {
            dirRef.current = 'CW';
            addLog(">> 방향 확정: 시계 ↻");
            ticksRef.current = [];
            phaseRef.current = 'ROTOR';
            sendToGlasses("DIR: CW");
         }
      }
      return;
    }

    if (phaseRef.current === 'ROTOR' || phaseRef.current === 'BALL') {
      ticksRef.current.push(now);
      const count = ticksRef.current.length;
      const dots = "• ".repeat(count).trim();
      addLog(`[${count}] 틱 감지! >> [ ${dots} ]`);
      sendToGlasses(dots);

      if (count === 2) {
         addLog(` -> 로터 주기 완료: ${((ticksRef.current[1] - ticksRef.current[0])/1000).toFixed(3)}초`);
         phaseRef.current = 'BALL';
      } else if (count === 4) {
         addLog(` -> 공 주기 완료: ${((ticksRef.current[3] - ticksRef.current[2])/1000).toFixed(3)}초`);
         
         const res = calculateKinematics(ticksRef.current, dirRef.current);
         if (res) {
            addLog(`🎯 예측 결과: Sector ${res.sector}`);
            sendToGlasses(`[ S${res.sector} ]`);
         } else {
            addLog(`❌ 에러: 공 속도가 너무 느림`);
            sendToGlasses(`ERROR`);
         }

         ticksRef.current = [];
         phaseRef.current = 'DIRECTION';
         dirRef.current = 'CCW';
      }
    }
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
      });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);
      
      setIsRunning(true);
      addLog("==== 유대모닉 파이 가동 ====");
      addLog("마이크 연결됨. 방향 틱 대기 중...");

      const analyze = () => {
        analyser.getFloatTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          sumSquares += dataArray[i] * dataArray[i];
        }
        const currentRms = Math.sqrt(sumSquares / bufferLength);
        setRms(currentRms);

        if (currentRms > THRESHOLD) {
          const now = Date.now();
          if (now - lastTickTimeRef.current > COOLDOWN_TIME) {
            handleTick(now);
          }
        }
        requestAnimationFrame(analyze);
      };
      requestAnimationFrame(analyze);
    } catch (e) {
      console.error(e);
      addLog("❌ 마이크 권한 획득 실패. (HTTPS 또는 Localhost 환경 필요)");
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1>Eudaemonic Pie</h1>
      <p style={{ color: '#666' }}>Even Hub G2 Smart Glasses</p>
      
      <button 
        onClick={startListening} 
        disabled={isRunning} 
        style={{ 
          padding: '15px 30px', 
          fontSize: '18px', 
          backgroundColor: isRunning ? '#ccc' : '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          width: '100%',
          cursor: isRunning ? 'default' : 'pointer'
        }}
      >
        {isRunning ? '▶ 시스템 가동 중...' : '마이크 켜기'}
      </button>

      <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
        <span>RMS: <strong>{rms.toFixed(5)}</strong></span>
        <span>기준치: {THRESHOLD}</span>
      </div>

      <div style={{ 
        background: '#1e1e1e', 
        color: '#4af626', 
        padding: '15px', 
        borderRadius: '8px', 
        marginTop: '20px', 
        height: '300px', 
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '14px',
        lineHeight: '1.5'
      }}>
        {logs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}
      </div>
    </div>
  );
}

export default App;
