class Microphone {
    constructor() {
        this.record = false;
        this.position = 0;
        this.sampleRate = this.getDeviceCaps()[0];
        this.channels = 2;
        this.duration = 0;
        this.initialized = false;
        this.permissionGranted = false;
        this.mediaAvailable = false;
        this.audioContext = null;
        this.requestingMedia = false;
        this.leapSync = false;
        this.mediaStreamSource = null;
        this.audioWorkletNode = null;
        this.devicesList = [];
        this.deviceKinds = {
            VideoInput: "videoinput",
            AudioInput: "audioinput",
            AudioOutput: "audiooutput"
        };
        this._initializePromise = null; // Promise 필드 추가
        this._initializePromise = this.initialize(this); // Promise 저장
        this.check();
    }

    async initialize(e) {
        // 이미 초기화되었거나 AudioContext가 running 상태이면 다시 초기화하지 않음
        if (e.initialized && e.audioContext && e.audioContext.state === 'running') {
            Microphone.log("initialize: Already initialized and AudioContext is running.");
            return;
        }
        
        // AudioContext가 존재하지만 닫힌 상태라면 새로 생성
        if (e.audioContext && e.audioContext.state === 'closed') {
            e.audioContext = null; // 기존 참조 해제
        }

        if (!e.audioContext) { // AudioContext가 없으면 새로 생성
            e.audioContext = new(window.AudioContext || window.webKitAudioContext);
        }

        await e.audioContext.audioWorklet.addModule("./mic-worklet-module.js");
        e.audioWorkletNode = new AudioWorkletNode(e.audioContext, "microphone-worklet");
        e.audioWorkletNode.port.onmessage = i => {
            e.nodeInputHandler(e, i)
        };
        e.initialized = true;
        Microphone.log("initialized. AudioContext state: " + e.audioContext.state);
    }

    async check() {
        await this.refreshDevices();
        await this.refreshDevices();
        this._checkIntervalId = setInterval(() => { // setInterval ID를 저장
            this.permissionStatusHandler(this)
        }, 1000);
    }

    getDeviceCaps() {
        return [16000, 48000];
    }

    getPosition() {
        return this.position;
    }

    isRecording() {
        return this.record;
    }

    async start(e, i, t, a) { // async 추가
        // start 호출 시 initialized가 false라면 initialize를 다시 시도
        if (!this.initialized) {
            Microphone.log("Start: Initializing Microphone as it was not initialized.");
            this._initializePromise = this.initialize(this); // 다시 초기화 시도
            await this._initializePromise; // 초기화 완료까지 기다림
        }

        if (true === this.record || true === this.requestingMedia || false === this.initialized) {
            Microphone.log("Start aborted: record=" + this.record + ", requestingMedia=" + this.requestingMedia + ", initialized=" + this.initialized);
            return;
        }

        // 마이크 권한 확인
        await this.refreshDevices(); // 최신 장치 목록 및 권한 상태 확인
        if (!this.permissionGranted) {
            Microphone.log("Start aborted: Microphone permission not granted.");
            document.microphoneNative.unityCommand("PermissionChanged", this.permissionGranted); // Unity에 권한 상태 전달
            return;
        }

        this.sampleRate = i;
        this.position = 0;
        this.loop = t;
        this.duration = a;
        let s = this.audioWorkletNode.parameters.get("frequency");
        s.setValueAtTime(this.sampleRate, this.audioContext.currentTime);
        let o = this.audioWorkletNode.parameters.get("channels");
        if (o.setValueAtTime(this.channels, this.audioContext.currentTime), this.requestingMedia = true, navigator.mediaDevices.getUserMedia) {
            var n = null;
            n = null !== e && navigator.mediaDevices.getSupportedConstraints().deviceId ? {
                audio: {
                    deviceId: {
                        exact: e
                    }
                }
            } : {
                audio: true
            };

            // 이미 미디어 스트림이 사용 가능한 경우 중복 요청 방지
            if (this.mediaAvailable && this.mediaStreamSource) {
                Microphone.log("Media stream already available, skipping getUserMedia.");
                this.mediaGranted(this, this.mediaStreamSource.mediaStream); // 기존 스트림으로 처리
            } else {
                Microphone.log("Requesting media stream with constraints: " + JSON.stringify(n));
                navigator.mediaDevices.getUserMedia(n).then(e => {
                    this.mediaGranted(this, e)
                }).catch(e => {
                    this.mediaFailed(this, e)
                });
            }
        }
    }

    end() {
        if (false === this.record || true === this.requestingMedia || false === this.initialized || null === this.mediaStreamSource) return;
        let e = this.audioWorkletNode.parameters.get("recording");
        e.setValueAtTime(0, this.audioContext.currentTime);
        this.record = false;
        this.mediaAvailable = false;
        this.mediaStreamSource.mediaStream.getTracks().forEach(e => e.stop());
        this.leapSync && this.mediaStreamSource.disconnect(this.audioContext.destination);
        this.mediaStreamSource.disconnect(this.audioWorkletNode);
        // setInterval 타이머 중지
        if (this._checkIntervalId !== null) {
            Microphone.log("clearInterval with ID: " + this._checkIntervalId); // 로그 추가
            clearInterval(this._checkIntervalId);
            this._checkIntervalId = null;
        }
        // AudioContext 닫기
        if (this.audioContext) {
            const currentAudioContext = this.audioContext; // 참조를 미리 저장
            const currentState = currentAudioContext.state; // state를 미리 읽어둠
            Microphone.log("Attempting to close AudioContext. Current state: " + currentState); // 로그 추가
            if (currentState !== 'closed') {
                currentAudioContext.close().then(() => {
                    Microphone.log("AudioContext closed successfully."); // Final state 로그 제거
                }).catch(e => {
                    Microphone.log("Failed to close AudioContext: " + e);
                });
            } else {
                Microphone.log("AudioContext is already closed."); // 로그 추가
            }
        }
        this.audioContext = null; // 참조 해제
        this.initialized = false; // 초기화 상태 재설정
        Microphone.log("end");
    }

    devices() {
        return this.devicesList;
    }




    devicePermitted(e) {
        let i = this.devices(),
            t = !!i.find(i => i.kind === e && !!i.label);
        return t;
    }

    setLeapSync(e) {
        this.leapSync = e;
    }

    mediaGranted(e, i) {
        let t = e.audioWorkletNode.parameters.get("recording");
        t.setValueAtTime(1, e.audioContext.currentTime);
        e.mediaAvailable = true;
        e.requestingMedia = false;
        e.record = true;
        e.mediaStreamSource = e.audioContext.createMediaStreamSource(i);
        e.mediaStreamSource.connect(e.audioWorkletNode);
        e.leapSync && e.mediaStreamSource.connect(e.audioContext.destination);
        Microphone.log("start");
    }

    mediaFailed(e, i) {
        e.mediaAvailable = false;
        e.requestingMedia = false;
        Microphone.log("media stream denied: " + i.name + " - " + i.message); // 에러 메시지 상세화
        Microphone.log(i);
    }

    async refreshDevices() {
        if (navigator.mediaDevices?.enumerateDevices) {
            if (!this.mediaAvailable) {
                try {
                    await navigator.mediaDevices.getUserMedia({
                        audio: true
                    });
                } catch (e) {
                    this.devicesList = [];
                    return;
                }
            }
            var i = await navigator.mediaDevices.enumerateDevices();
            this.devicesList = [];
            for (var t = 0; t < i.length; t++) {
                if (i[t].kind === this.deviceKinds.AudioInput) {
                    var a = {
                        deviceId: i[t].deviceId,
                        kind: i[t].kind,
                        label: i[t].label,
                        groupId: i[t].groupId
                    };
                    this.devicesList.push(a);
                }
            }
        }
    }

    nodeInputHandler(e, i) {
        if (!e.record || e.position / e.sampleRate >= e.duration && !e.loop) return;
        let t = i.data;
        if (void 0 == t || void 0 == t.data[0]) return;
        let a = Math.min(t.channels, this.channels),
            s = t.data[0].length,
            o = t.data,
            n = document.microphoneNative.samplesMemoryDataLeftChannel.length,
            r = e.position,
            d = 0;
        for (let c = 0; c < s; c++) {
            for (let l = 0; l < a; l++) {
                0 == l ? document.microphoneNative.samplesMemoryDataLeftChannel[e.position] = o[l][c] : document.microphoneNative.samplesMemoryDataRightChannel[e.position] = o[l][c];
            }
            if (e.position++, e.position + 1 > n) {
                if (e.loop) e.position = 0;
                else {
                    e.position = Math.max(0, n - 1);
                    break;
                }
            }
            d++;
        }
        document.microphoneNative.unityCommand("StreamChunkReceived", r + ":" + d);
    }

    async permissionStatusHandler(e) {
        await e.refreshDevices();
        let i = e.devicePermitted(e.deviceKinds.AudioInput);
        if (e.permissionGranted !== i) {
            e.setPermissionStatus(i);
            Microphone.log("Permission status changed to: " + i); // 로그 추가
        }
    }

    setPermissionStatus(e) {
        this.permissionGranted = e;
        document.microphoneNative.unityCommand("PermissionChanged", this.permissionGranted);
    }

    static log(e) {
        console.log("[Unity][WebGL][Microphone]: " + e);
    }
}
