"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useAuthApi } from "../../lib/auth-session";
import { count, istDay, istDayYear, istOrderTime, istTime, price, shortNumber } from "./format";
import type { Candle, Chart, ChartRange } from "./types";

const rangeList: ChartRange[] = ["1D", "1W", "1M", "6M", "1Y", "5Y"];
const height = 300;
const padTop = 14;
const padBottom = 14;
const padLeft = 8;
/** Room on the right for the price labels. */
const gutter = 70;

function timeLabel(time: number, range: ChartRange) {
  if (range === "1D") return istTime.format(time);
  if (range === "1W") return istOrderTime.format(time);
  if (range === "5Y") return istDayYear.format(time);
  return istDay.format(time);
}

type Props = {
  symbol: string;
  /** Latest delayed price; drawn as the final point so the chart agrees with the quote. */
  lastPrice: number;
  onMeta?: (chart: Chart) => void;
};

export default function StockChart({ symbol, lastPrice, onMeta }: Props) {
  const authFetch = useAuthApi();
  const [range, setRange] = useState<ChartRange>("1D");
  const [mode, setMode] = useState<"area" | "candles">("area");
  const [chart, setChart] = useState<Chart | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  const box = useRef<HTMLDivElement>(null);
  const requestKey = `${symbol}|${range}`;
  const [loadedKey, setLoadedKey] = useState("");
  const onMetaRef = useRef(onMeta);
  useEffect(() => { onMetaRef.current = onMeta; }, [onMeta]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    authFetch(`/v1/market/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("chart unavailable");
        return response.json() as Promise<Chart>;
      })
      .then((data) => {
        if (!active) return;
        setChart(data);
        setFailed(false);
        setLoadedKey(`${symbol}|${range}`);
        onMetaRef.current?.(data);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setLoadedKey(`${symbol}|${range}`);
      });
    return () => { active = false; };
  }, [authFetch, symbol, range]);

  const loading = loadedKey !== requestKey;
  const candles = useMemo<Candle[]>(() => {
    if (!chart || chart.symbol !== symbol) return [];
    const list = chart.candles.slice();
    // Keep the last point in step with the latest quote for the intraday view.
    if (range === "1D" && list.length && Math.abs(list[list.length - 1].close - lastPrice) > 0.001) {
      const last = list[list.length - 1];
      list[list.length - 1] = { ...last, close: lastPrice, high: Math.max(last.high, lastPrice), low: Math.min(last.low, lastPrice) };
    }
    return list;
  }, [chart, symbol, range, lastPrice]);

  const baseline = range === "1D" && chart?.previousClose ? chart.previousClose : candles[0]?.open ?? 0;
  const lows = candles.map((candle) => (mode === "candles" ? candle.low : candle.close));
  const highs = candles.map((candle) => (mode === "candles" ? candle.high : candle.close));
  const min = Math.min(...lows, range === "1D" && baseline ? baseline : Infinity);
  const max = Math.max(...highs, range === "1D" && baseline ? baseline : -Infinity);
  const span = max - min || 1;
  const y = (value: number) => padTop + (1 - (value - min) / span) * (height - padTop - padBottom);
  const plotWidth = Math.max(40, width - padLeft - gutter);
  // Candles need half a body of room at each end; lines can run edge to edge.
  const inset = mode === "candles" ? Math.min(10, plotWidth / Math.max(candles.length, 1) / 2) : 0;
  const step = candles.length > 1 ? (plotWidth - 2 * inset) / (candles.length - 1) : plotWidth;
  const x = (index: number) => padLeft + inset + (candles.length > 1 ? index * step : plotWidth / 2);
  const last = candles[candles.length - 1];
  const up = last ? last.close >= baseline : true;
  const color = up ? "var(--up)" : "var(--down)";

  const linePath = candles.map((candle, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(candle.close).toFixed(1)}`).join(" ");
  const areaPath = candles.length ? `${linePath} L${x(candles.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z` : "";
  const bodyWidth = Math.max(1, Math.min(14, (plotWidth / Math.max(candles.length, 1)) * 0.62));
  const gridLevels = [0, 0.25, 0.5, 0.75, 1].map((fraction) => max - span * fraction);
  const xTicks = candles.length > 4 ? [0, Math.floor(candles.length / 3), Math.floor((2 * candles.length) / 3), candles.length - 1] : [];

  const active = hover !== null ? candles[hover] : undefined;
  const shown = active ?? last;

  function track(event: PointerEvent<HTMLDivElement>) {
    if (!candles.length || !box.current) return;
    const left = box.current.getBoundingClientRect().left;
    const index = Math.round((event.clientX - left - padLeft - inset) / (candles.length > 1 ? step : 1));
    setHover(Math.max(0, Math.min(candles.length - 1, index)));
  }

  return (
    <div className="xt-chart">
      <div className="xt-chart-bar">
        <div className="xt-chart-legend">
          {shown ? (
            <>
              <span>{active ? timeLabel(active.time, range) : "Last"}</span>
              <span>O <b>{price(shown.open)}</b></span><span>H <b>{price(shown.high)}</b></span>
              <span>L <b>{price(shown.low)}</b></span><span>C <b className={shown.close >= shown.open ? "up" : "down"}>{price(shown.close)}</b></span>
              {shown.volume > 0 && <span>Vol <b>{shortNumber(shown.volume)}</b></span>}
            </>
          ) : <span>&nbsp;</span>}
        </div>
        <div className="xt-chart-controls">
          <div className="xt-seg" role="group" aria-label="Chart range">
            {rangeList.map((item) => (
              <button aria-pressed={range === item} key={item} onClick={() => { setRange(item); setHover(null); }} type="button">{item}</button>
            ))}
          </div>
          <div className="xt-seg" role="group" aria-label="Chart style">
            <button aria-pressed={mode === "area"} onClick={() => setMode("area")} title="Line" type="button">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 12l4-5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            </button>
            <button aria-pressed={mode === "candles"} onClick={() => setMode("candles")} title="Candles" type="button">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v12M12 2v12" stroke="currentColor" strokeWidth="1.2" /><rect x="2.5" y="5" width="3" height="6" fill="currentColor" /><rect x="10.5" y="4" width="3" height="5" fill="none" stroke="currentColor" /></svg>
            </button>
          </div>
        </div>
      </div>

      <div aria-label={`${symbol} price chart, ${range}`} className="xt-chart-plot" onPointerLeave={() => setHover(null)}
        onPointerMove={track} ref={box} role="img">
        {candles.length > 0 && (
          <svg height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
            <defs>
              <linearGradient id={`fill-${up ? "up" : "down"}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {gridLevels.map((level) => <line className="xt-grid" key={level} x1="0" x2={width - gutter + 6} y1={y(level)} y2={y(level)} />)}
            {range === "1D" && chart?.previousClose && (
              <line className="xt-baseline" x1="0" x2={width - gutter + 6} y1={y(chart.previousClose)} y2={y(chart.previousClose)} />
            )}
            {mode === "area" ? (
              <>
                <path d={areaPath} fill={`url(#fill-${up ? "up" : "down"})`} />
                <path d={linePath} fill="none" stroke={color} strokeLinejoin="round" strokeWidth="1.8" />
              </>
            ) : candles.map((candle, index) => {
              const rising = candle.close >= candle.open;
              const top = y(Math.max(candle.open, candle.close));
              return (
                <g className={rising ? "xt-candle up" : "xt-candle down"} key={candle.time}>
                  <line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} />
                  <rect height={Math.max(1, y(Math.min(candle.open, candle.close)) - top)} width={bodyWidth} x={x(index) - bodyWidth / 2} y={top} />
                </g>
              );
            })}
            {active && hover !== null && (
              <g className="xt-crosshair">
                <line x1={x(hover)} x2={x(hover)} y1="0" y2={height} />
                <line x1="0" x2={width - gutter + 6} y1={y(active.close)} y2={y(active.close)} />
                <circle cx={x(hover)} cy={y(active.close)} fill={color} r="3.5" />
              </g>
            )}
          </svg>
        )}
        {candles.length > 0 && (
          <div aria-hidden="true" className="xt-axis-y">
            {gridLevels.map((level) => <span key={level} style={{ top: y(level) }}>{price(level)}</span>)}
          </div>
        )}
        {(loading || failed || candles.length === 0) && (
          <div className="xt-chart-state">
            {loading ? <span className="xt-spinner" aria-label="Loading chart" /> : failed ? "Chart data is unavailable right now." : "No trades in this range yet."}
          </div>
        )}
      </div>
      <div aria-hidden="true" className="xt-axis-x" style={{ paddingRight: gutter }}>
        {xTicks.map((index) => <span key={index}>{timeLabel(candles[index].time, range)}</span>)}
      </div>
      {candles.length > 0 && (
        <p className="xt-chart-note">
          {count(candles.length)} {range === "1D" ? "5-minute" : range === "1W" ? "15-minute" : range === "5Y" ? "weekly" : "daily"} bars · NSE · delayed
        </p>
      )}
    </div>
  );
}
