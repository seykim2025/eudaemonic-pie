import { useState, useRef } from 'react';
import { waitForEvenAppBridge, TextContainerUpgrade } from '@evenrealities/even_hub_sdk';
import { calculateKinematics } from './kinematics';
import mqtt from 'mqtt';

const SERVICE_UUID = '19b10000-e8f2-537e-4f6c-d104768a1214';
const CHAR_UUID = '19b10001-e8f2-537e-4f6c-d104768a1214';
const MQTT_BROKER = 'wss://broker.emqx.io:8083/mqtt';
const MQTT_TOPIC = 'eudaemonic_pie_seykim_roulette_cmd'; // Hardcoded unique topic

type AppMode = 'SELECT' | 'HUD' | 'CONTROLLER';
type Phase = 'DIRECTION' | 'ROTOR' | 'BALL';
const COOLDOWN_TIME = 300; 
const DOUBLE_TAP_WINDOW = 600; 

function App() {
  const [appMode, setAppMode] = useState<AppMode>('SELECT');
  const [logs, setLogs] = useState<string[]>([]);
  
  // HUD State
  const [mqttConnectedHUD, setMqttConnectedHUD] = useState(false);
  const [sdkConnected, setSdkConnected] = useState(false);

  // Controller State
  const [bleConnected, setBleConnected] = useState(false);
  const [mqttConnectedCTRL, setMqttConnectedCTRL] = useState(false);

  const phaseRef = useRef<Phase>('DIRECTION');
  const dirRef = useRef<'CW' | 'CCW'>('CCW');
  const ticksRef = useRef<number[]>([]);
  const lastTickTimeRef = useRef<number>(0);
  const mqttClientRef = useRef<mqtt.MqttClient | null>(null);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg].slice(-15));

  // ----------------------------------------------------
  // HUD (안경 송신기) 로직
  // ----------------------------------------------------
  const startHUDMode = async () => {
    setAppMode('HUD');
    addLog("==== 안경 디스플레이 모드 시작 ====");
    
    // 1. SDK 연결
    try {
      const bridge = await waitForEvenAppBridge();
      const textObject: any[] = [{
        xPosition: 50, yPosition: 100, width: 300, height: 60,
        containerID: 1, containerName: 'hud-text', zOrderIndex: 1,
        content: 'Eudaemonic Pie', isEventCapture: 1,
      }];
      
      await bridge.createStartUpPageContainer({ containerTotalNum: 1, textObject } as any);
      setSdkConnected(true);
      addLog("✔️ 안경 연결 완료");
    } catch (e: any) {
      addLog(`❌ SDK 오류: ${e.message}`);
    }

    // 2. MQTT 연결 (수신)
    try {
      const client = mqtt.connect(MQTT_BROKER);
      client.on('connect', () => {
        setMqttConnectedHUD(true);
        addLog("✔️ 퍼블릭 서버(MQTT) 접속 완료");
        client.subscribe(MQTT_TOPIC, (err) => {
          if (!err) addLog(">> 컨트롤러 신호 수신 대기 중...");
        });
      });
      
      client.on('message', async (_topic, message) => {
        const text = message.toString();
        addLog(`수신됨: ${text.replace(/\n/g, ' ')}`);
        
        // SDK가 연결되었을 것으로 간주하고 전송 시도
        try {
          const bridge = await waitForEvenAppBridge();
          const req = new TextContainerUpgrade({ containerID: 1, content: text });
          await bridge.textContainerUpgrade(req);
        } catch(e) {
          addLog("안경 전송 실패");
        }
      });
      
      client.on('error', (err) => addLog(`MQTT 오류: ${err.message}`));
      mqttClientRef.current = client;
    } catch (e: any) {
      addLog(`❌ 서버 접속 실패: ${e.message}`);
    }
  };

  // ----------------------------------------------------
  // 컨트롤러 (조종기) 로직
  // ----------------------------------------------------
  const startControllerMode = () => {
    setAppMode('CONTROLLER');
    addLog("==== 센서 컨트롤러 모드 시작 ====");
    
    // MQTT 연결 (발신)
    try {
      const client = mqtt.connect(MQTT_BROKER);
      client.on('connect', () => {
        setMqttConnectedCTRL(true);
        addLog("✔️ 서버(MQTT) 송신망 접속 완료");
      });
      mqttClientRef.current = client;
    } catch (e: any) {
      addLog(`❌ 서버 접속 실패: ${e.message}`);
    }
  };

  const connectBLE = async () => {
    try {
      addLog("BLE 기기 검색 중...");
      const nav: any = navigator;
      const device = await nav.bluetooth.requestDevice({
        filters: [{ name: 'EudaemonicToe' }],
        optionalServices: [SERVICE_UUID]
      });
      
      addLog(`기기 발견: ${device.name}, 연결 시도...`);
      device.addEventListener('gattserverdisconnected', () => {
        setBleConnected(false);
        addLog("❌ BLE 연결 끊어짐!");
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error("GATT Server 못 찾음");
      
      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(CHAR_UUID);
      
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const val = event.target.value.getUint8(0);
        if (val === 1) {
           const now = Date.now();
           if (now - lastTickTimeRef.current > COOLDOWN_TIME) {
             lastTickTimeRef.current = now;
             handleTick(now);
           }
        }
      });
      
      setBleConnected(true);
      addLog("✔️ 발가락 센서 연결 완료! 🎯");
    } catch (error: any) {
      addLog(`❌ BLE 실패: ${error.message}`);
    }
  };

  // ----------------------------------------------------
  // 틱 처리 및 연산 (컨트롤러 측에서만 실행됨)
  // ----------------------------------------------------
  const sendToHUD = (text: string) => {
    if (mqttClientRef.current && mqttClientRef.current.connected) {
      mqttClientRef.current.publish(MQTT_TOPIC, text);
    }
  };

  const handleTick = (now: number) => {
    if (phaseRef.current === 'DIRECTION') {
      ticksRef.current.push(now);
      if (ticksRef.current.length === 1) {
         addLog("[방향] 틱 감지! 싱글=↺, 더블=↻...");
         setTimeout(() => {
            if (phaseRef.current === 'DIRECTION' && ticksRef.current.length === 1) {
               dirRef.current = 'CCW';
               addLog(">> 방향 확정: 반시계 ↺");
               ticksRef.current = [];
               phaseRef.current = 'ROTOR';
               sendToHUD("DIR: CCW");
               addLog("로터 측정을 시작하세요.");
            }
         }, DOUBLE_TAP_WINDOW);
      } else if (ticksRef.current.length === 2) {
         const interval = ticksRef.current[1] - ticksRef.current[0];
         if (interval <= DOUBLE_TAP_WINDOW) {
            dirRef.current = 'CW';
            addLog(">> 방향 확정: 시계 ↻");
            ticksRef.current = [];
            phaseRef.current = 'ROTOR';
            sendToHUD("DIR: CW");
            addLog("로터 측정을 시작하세요.");
         }
      }
      return;
    }

    if (phaseRef.current === 'ROTOR' || phaseRef.current === 'BALL') {
      ticksRef.current.push(now);
      const count = ticksRef.current.length;
      const dots = "• ".repeat(count).trim();
      addLog(`[${count}] 틱 감지! >> [ ${dots} ]`);
      sendToHUD(dots);

      if (count === 2) {
         addLog(` -> 로터 주기: ${((ticksRef.current[1] - ticksRef.current[0])/1000).toFixed(3)}초`);
         phaseRef.current = 'BALL';
      } else if (count === 4) {
         addLog(` -> 공 주기: ${((ticksRef.current[3] - ticksRef.current[2])/1000).toFixed(3)}초`);
         const res = calculateKinematics(ticksRef.current, dirRef.current);
         if (res) {
            addLog(`🎯 예측 결과: Sector ${res.sector}`);
            sendToHUD(`🎯 [ S${res.sector} ]`);
         } else {
            addLog(`❌ 에러: 공 속도가 너무 느림`);
            sendToHUD(`ERROR`);
         }
         ticksRef.current = [];
         phaseRef.current = 'DIRECTION';
         dirRef.current = 'CCW';
      }
    }
  };

  // ----------------------------------------------------
  // UI 렌더링
  // ----------------------------------------------------
  return (
    <div style={{ padding: '16px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: '24px' }}>Eudaemonic Pie</h1>
      <p style={{ color: '#888', margin: '0 0 20px', fontSize: '13px' }}>v0.1.26 | MQTT Distributed</p>
      
      {appMode === 'SELECT' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button 
            onClick={startHUDMode}
            style={{ padding: '20px', fontSize: '16px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            👓 안경 디스플레이 모드<br/>
            <span style={{ fontSize: '12px', fontWeight: 'normal' }}>(Even App 웹뷰 전용)</span>
          </button>
          <button 
            onClick={startControllerMode}
            style={{ padding: '20px', fontSize: '16px', background: '#1976D2', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            🦶 센서 컨트롤러 모드<br/>
            <span style={{ fontSize: '12px', fontWeight: 'normal' }}>(외부 크롬 브라우저 전용)</span>
          </button>
        </div>
      )}

      {appMode === 'HUD' && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <div style={{ flex: 1, padding: '12px', background: sdkConnected ? '#4CAF50' : '#888', color: 'white', borderRadius: '8px', textAlign: 'center' }}>
            {sdkConnected ? '✔️ 안경 연결됨' : '⏳ 안경 연결 중'}
          </div>
          <div style={{ flex: 1, padding: '12px', background: mqttConnectedHUD ? '#1976D2' : '#888', color: 'white', borderRadius: '8px', textAlign: 'center' }}>
            {mqttConnectedHUD ? '🟢 신호 대기 중' : '⏳ 서버 접속 중'}
          </div>
        </div>
      )}

      {appMode === 'CONTROLLER' && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <div style={{ flex: 1, padding: '12px', background: mqttConnectedCTRL ? '#4CAF50' : '#888', color: 'white', borderRadius: '8px', textAlign: 'center' }}>
            {mqttConnectedCTRL ? '✔️ 서버 연결됨' : '⏳ 서버 접속 중'}
          </div>
          {!bleConnected ? (
            <button 
              onClick={connectBLE}
              style={{ flex: 1, padding: '12px', fontSize: '14px', background: '#1976D2', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              🦶 센서 블루투스 연결
            </button>
          ) : (
            <div style={{ flex: 1, padding: '12px', background: '#4CAF50', color: 'white', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold' }}>
              🟢 센서 연동 완료
            </div>
          )}
        </div>
      )}

      {appMode !== 'SELECT' && (
        <div style={{ background: '#f5f5f5', borderRadius: '8px', padding: '12px', marginTop: '20px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '14px' }}>시스템 로그 ({appMode})</h3>
          <div style={{ background: 'black', color: '#0f0', padding: '10px', borderRadius: '4px', height: '240px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.4' }}>
            {logs.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
