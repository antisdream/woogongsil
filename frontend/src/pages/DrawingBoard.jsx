// 연습장 라우트 페이지 컴포넌트입니다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 1700;
const STORAGE_PREFIX = 'wgs_drawing_board_v8';
const DEFAULT_COLOR = '#ef4444';

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function buildKeys(storageKey) {
    const safeKey = String(storageKey || 'default');
    return {
        canvas: `${STORAGE_PREFIX}:${safeKey}:canvas`,
        text: `${STORAGE_PREFIX}:${safeKey}:text`,
        legacy: safeKey
    };
}

export default function DrawingBoard({ storageKey = 'drawing-board', height = 640 }) {
    const canvasRef = useRef(null);
    const textRef = useRef(null);
    const drawingRef = useRef(false);
    const lastPointRef = useRef(null);
    const activeKeys = useMemo(() => buildKeys(storageKey), [storageKey]);

    const [tool, setTool] = useState('pen');
    const [color, setColor] = useState(DEFAULT_COLOR);
    const [penWidth, setPenWidth] = useState(3);
    const [eraserWidth, setEraserWidth] = useState(16);
    const [fontSize, setFontSize] = useState(16);
    const [zoom, setZoom] = useState(1);
    const [history, setHistory] = useState([]);
    const [redoStack, setRedoStack] = useState([]);

    const getCanvasData = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return '';
        try {
            return canvas.toDataURL('image/png');
        } catch {
            return '';
        }
    }, []);

    const saveCanvas = useCallback(() => {
        const dataUrl = getCanvasData();
        if (!dataUrl) return;
        localStorage.setItem(activeKeys.canvas, dataUrl);
        // 기존 메모장 키를 읽던 화면도 같은 내용을 볼 수 있도록 기존 storageKey에도 함께 저장합니다.
        localStorage.setItem(activeKeys.legacy, dataUrl);
    }, [activeKeys.canvas, activeKeys.legacy, getCanvasData]);

    const pushHistory = useCallback(() => {
        const dataUrl = getCanvasData();
        if (!dataUrl) return;
        setHistory((prev) => [...prev.slice(-24), dataUrl]);
        setRedoStack([]);
    }, [getCanvasData]);

    const drawImageToCanvas = useCallback((dataUrl) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!dataUrl) return;
        const image = new Image();
        image.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        };
        image.src = dataUrl;
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const savedCanvas = localStorage.getItem(activeKeys.canvas) || localStorage.getItem(activeKeys.legacy) || '';
        drawImageToCanvas(savedCanvas);
        const savedText = localStorage.getItem(activeKeys.text) || '';
        if (textRef.current) textRef.current.innerText = savedText;
        setHistory(savedCanvas ? [savedCanvas] : [canvas.toDataURL('image/png')]);
        setRedoStack([]);
    }, [activeKeys.canvas, activeKeys.legacy, activeKeys.text, drawImageToCanvas]);

    useEffect(() => {
        const syncFromOtherBoard = (event) => {
            if (event.key === activeKeys.canvas && event.newValue) {
                drawImageToCanvas(event.newValue);
            }
            if (event.key === activeKeys.text && textRef.current) {
                textRef.current.innerText = event.newValue || '';
            }
        };
        window.addEventListener('storage', syncFromOtherBoard);
        return () => window.removeEventListener('storage', syncFromOtherBoard);
    }, [activeKeys.canvas, activeKeys.text, drawImageToCanvas]);

    const getPoint = (event) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const source = event.touches?.[0] || event;
        const rect = canvas.getBoundingClientRect();
        return {
            x: (source.clientX - rect.left) * (canvas.width / rect.width),
            y: (source.clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const beginDraw = (event) => {
        if (tool === 'text') return;
        event.preventDefault();
        const point = getPoint(event);
        if (!point) return;
        pushHistory();
        drawingRef.current = true;
        lastPointRef.current = point;
    };

    const moveDraw = (event) => {
        if (!drawingRef.current || tool === 'text') return;
        event.preventDefault();
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        const point = getPoint(event);
        const lastPoint = lastPointRef.current;
        if (!canvas || !ctx || !point || !lastPoint) return;

        ctx.save();
        ctx.globalCompositeOperation = tool === 'eraser'? 'destination-out' : 'source-over';
        ctx.strokeStyle = color;
        ctx.lineWidth = tool === 'eraser'? eraserWidth : penWidth;
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        ctx.restore();
        lastPointRef.current = point;
    };

    const endDraw = () => {
        if (!drawingRef.current) return;
        drawingRef.current = false;
        lastPointRef.current = null;
        saveCanvas();
    };

    const saveText = () => {
        const text = textRef.current?.innerText || '';
        localStorage.setItem(activeKeys.text, text);
    };

    const clearBoard = () => {
        if (!window.confirm('현재 문제의 풀이 연습장을 모두 지우시겠습니까?')) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
            pushHistory();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            saveCanvas();
        }
        if (textRef.current) textRef.current.innerText = '';
        localStorage.setItem(activeKeys.text, '');
    };

    const undo = () => {
        if (history.length <= 1) return;
        const current = getCanvasData();
        const nextHistory = history.slice(0, -1);
        const previous = nextHistory[nextHistory.length - 1] || '';
        setRedoStack((prev) => [current, ...prev].slice(0, 25));
        setHistory(nextHistory);
        drawImageToCanvas(previous);
        if (previous) localStorage.setItem(activeKeys.canvas, previous);
    };

    const redo = () => {
        const [next, ...rest] = redoStack;
        if (!next) return;
        setHistory((prev) => [...prev, next].slice(-25));
        setRedoStack(rest);
        drawImageToCanvas(next);
        localStorage.setItem(activeKeys.canvas, next);
    };

    const contentWidth = CANVAS_WIDTH * zoom;
    const contentHeight = CANVAS_HEIGHT * zoom;

    return (
        <div className="wgs-drawing-board-v8">
            <div className="wgs-drawing-toolbar" aria-label="문제 풀이 연습장 도구">
                <div className="wgs-toolbar-row wgs-toolbar-primary">
                    <div className="wgs-toolbar-group wgs-tool-buttons" aria-label="도구 선택">
                        <button type="button" className={tool === 'pen'? 'active' : ''} onClick={() => setTool('pen')}>펜</button>
                        <button type="button" className={tool === 'eraser'? 'active' : ''} onClick={() => setTool('eraser')}>지우개</button>
                        <button type="button" className={tool === 'text'? 'active' : ''} onClick={() => setTool('text')}>텍스트</button>
                    </div>

                    <label className="wgs-toolbar-field wgs-color-field">
                        <span>색상</span>
                        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
                    </label>

                    <button type="button" className="danger" onClick={clearBoard}>전체 지우기</button>
                </div>

                <div className="wgs-toolbar-row wgs-toolbar-secondary">
                    <div className="wgs-toolbar-group wgs-size-controls" aria-label="굵기와 글자 설정">
                        <label className="wgs-toolbar-field">
                            <span>펜 굵기</span>
                            <select value={penWidth} onChange={(event) => setPenWidth(clampNumber(event.target.value, 1, 16, 3))}>
                                <option value="2">2단</option>
                                <option value="3">3단</option>
                                <option value="5">5단</option>
                                <option value="8">8단</option>
                            </select>
                        </label>
                        <label className="wgs-toolbar-field">
                            <span>지우개</span>
                            <select value={eraserWidth} onChange={(event) => setEraserWidth(clampNumber(event.target.value, 4, 60, 16))}>
                                <option value="10">1단</option>
                                <option value="16">2단</option>
                                <option value="24">3단</option>
                                <option value="36">4단</option>
                            </select>
                        </label>
                        <label className="wgs-toolbar-field wgs-font-field">
                            <span>글자</span>
                            <input type="number" min="10" max="48" value={fontSize} onChange={(event) => setFontSize(clampNumber(event.target.value, 10, 48, 16))} />
                            <em>px</em>
                        </label>
                    </div>

                    <div className="wgs-toolbar-group wgs-zoom-controls" aria-label="확대 축소">
                        <button type="button" className="dark" onClick={() => setZoom((prev) => clampNumber((prev - 0.1).toFixed(1), 0.6, 2, 1))}>−</button>
                        <strong>{Math.round(zoom * 100)}%</strong>
                        <button type="button" className="dark" onClick={() => setZoom((prev) => clampNumber((prev + 0.1).toFixed(1), 0.6, 2, 1))}>＋</button>
                    </div>

                    <div className="wgs-toolbar-group wgs-history-controls" aria-label="되돌리기와 다시 실행">
                        <button type="button" className="dark" onClick={undo}>실행 취소</button>
                        <button type="button" className="dark" onClick={redo}>다시 실행</button>
                    </div>
                </div>
            </div>

            <div className="wgs-drawing-scroll" style={{ height }}>
                <div className="wgs-drawing-content" style={{ width: contentWidth, height: contentHeight }}>
                    <canvas
                        ref={canvasRef}
                        style={{ width: contentWidth, height: contentHeight }}
                        onMouseDown={beginDraw}
                        onMouseMove={moveDraw}
                        onMouseUp={endDraw}
                        onMouseLeave={endDraw}
                        onTouchStart={beginDraw}
                        onTouchMove={moveDraw}
                        onTouchEnd={endDraw}
                    />
                    <div
                        ref={textRef}
                        className={`wgs-drawing-text-layer ${tool === 'text'? 'editable' : ''}`}
                        contentEditable={tool === 'text'}
                        suppressContentEditableWarning
                        spellCheck={false}
                        onInput={saveText}
                        onBlur={saveText}
                        style={{
                            width: contentWidth,
                            height: contentHeight,
                            fontSize: `${fontSize * zoom}px`,
                            color
                        }}
                    />
                </div>
            </div>

            <style>{`
                .wgs-drawing-board-v8 { width: 100%; }
                .wgs-drawing-toolbar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
                .wgs-toolbar-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; width: 100%; }
                .wgs-toolbar-primary { justify-content: space-between; }
                .wgs-toolbar-secondary { justify-content: flex-start; }
                .wgs-toolbar-group { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
                .wgs-tool-buttons { flex: 1 1 230px; }
                .wgs-size-controls { flex: 1 1 340px; }
                .wgs-zoom-controls, .wgs-history-controls, .wgs-color-field { flex: 0 0 auto; }
                .wgs-drawing-toolbar button { border: 0; border-radius: 12px; background: var(--wgs-drawing-control-bg, #fff); color: var(--wgs-drawing-control-text, #0f172a); padding: 11px 15px; font-weight: 900; cursor: pointer; box-shadow: 0 1px 3px rgba(15,23,42,.08); white-space: nowrap; }
                .wgs-drawing-toolbar button.active { background: #3b82f6; color: #fff; }
                .wgs-drawing-toolbar button.dark { background: #111827; color: #fff; min-width: 42px; }
                .wgs-drawing-toolbar button.danger { background: #ef4444; color: #fff; margin-left: auto; }
                .wgs-toolbar-field { display: inline-flex; align-items: center; gap: 6px; font-weight: 900; color: var(--wgs-drawing-text, #0f172a); white-space: nowrap; }
                .wgs-toolbar-field span { display: inline-block; white-space: nowrap; }
                .wgs-toolbar-field em { font-style: normal; font-weight: 900; }
                .wgs-drawing-toolbar select,
                .wgs-drawing-toolbar input[type="number"] { border: 1px solid var(--wgs-drawing-control-border, #dbe6f4); border-radius: 12px; background: var(--wgs-drawing-control-bg, #fff); color: var(--wgs-drawing-control-text, #0f172a); height: 42px; padding: 0 10px; font-size: 15px; }
                .wgs-drawing-toolbar input[type="color"] { width: 46px; height: 34px; border: 1px solid var(--wgs-drawing-control-border, #dbe6f4); border-radius: 999px; background: var(--wgs-drawing-control-bg, #fff); padding: 2px; }
                .wgs-drawing-scroll { overflow: auto; border: 1px dashed #c9d9ec; border-radius: 12px; background: #fff7e6; }
                .wgs-drawing-content { position: relative; background: repeating-linear-gradient(0deg, #fff7e6 0px, #fff7e6 45px, #efe4cf 47px); }
                .wgs-drawing-content canvas { position: absolute; left: 0; top: 0; z-index: 1; touch-action: none; cursor: crosshair; }
                .wgs-drawing-text-layer { position: absolute; left: 0; top: 0; z-index: 2; box-sizing: border-box; padding: 16px; white-space: pre-wrap; word-break: break-word; outline: none; pointer-events: none; line-height: 1.5; font-weight: 700; }
                .wgs-drawing-text-layer.editable { pointer-events: auto; cursor: text; }
                @media (max-width: 720px) {
                    .wgs-drawing-toolbar button.danger { margin-left: 0; }
                    .wgs-drawing-toolbar { gap: 8px; }
                    .wgs-tool-buttons, .wgs-size-controls { flex-basis: 100%; }
                }
            `}</style>
        </div>
    );
}
