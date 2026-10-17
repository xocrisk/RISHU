"use client";

import {
  ColorType, CrosshairMode, LineStyle, createChart,
  type IChartApi, type ISeriesApi, type MouseEventParams, type SeriesType, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuthApi } from "../../lib/auth-session";
import { count, istDay, istDayYear, istOrderTime, istTime, price, shortNumber } from "./format";
import type { Candle, Chart, ChartRange } from "./types";

const rangeList: ChartRange[] = ["1D", "1W", "1M", "6M", "1Y", "5Y"];
type Style = "candles" | "area" | "line";
// lightweight-charts draws times in UTC; shifting by IST's offset makes the axis read in Indian time.
const istOffsetSeconds = 5.5 * 3600;
const toChartTime = (ms: number) => (Math.floor(ms / 1000) + istOffsetSeconds) as UTCTimestamp;
const fromChartTime = (time: Time) => ((time as number) - istOffsetSeconds) * 1000;

function timeLabel(time: number, range: ChartRange) {
  if (range === "1D") return istTime.format(time);
  if (range === "1W") return istOrderTime.format(time);
  if (range === "5Y") return istDayYear.format(time);
  return istDay.format(time);
}

function palette(element: HTMLElement) {
  const css = getComputedStyle(element);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--panel", "#ffffff"), text: read("--muted", "#667085"), line: read("--line", "#e7e9ee"),
    up: read("--up", "#12a150"), down: read("--down", "#e5383b"), gold: read("--gold", "#b8862f"), faint: read("--faint", "#98a2b3"),
  };
}

type Props = {
  symbol: string;
  /** Latest delayed price; drawn as the final point so the chart agrees with the quote. */
  lastPrice: number;
  onMeta?: (chart: Chart) => void;
  /** Buttons shown in the full-screen view (Buy / Sell). */
  actions?: ReactNode;
};

export default function StockChart({ symbol, lastPrice, onMeta, actions }: Props) {
  const authFetch = useAuthApi();
  const [range, setRange] = useState<ChartRange>("1D");
  const [style, setStyle] = useState<Style>("candles");
  const [chart, setChart] = useState<Chart | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<Candle | null>(null);
  const [full, setFull] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{ chart: IChartApi; main: ISeriesApi<SeriesType>; volume: ISeriesApi<"Histogram"> } | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const onMetaRef = useRef(onMeta);
  useEffect(() => { onMetaRef.current = onMeta; }, [onMeta]);
  const loading = loadedKey !== `${symbol}|${range}`;

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

  const candles = useMemo<Candle[]>(() => {
    if (!chart || chart.symbol !== symbol) return [];
    // The chart needs strictly increasing times.
    const byTime = new Map<number, Candle>();
    for (const candle of chart.candles) byTime.set(toChartTime(candle.time), candle);
    const list = [...byTime.values()].sort((a, b) => a.time - b.time);
    if (range === "1D" && list.length && Math.abs(list[list.length - 1].close - lastPrice) > 0.001) {
      const last = list[list.length - 1];
      list[list.length - 1] = { ...last, close: lastPrice, high: Math.max(last.high, lastPrice), low: Math.min(last.low, lastPrice) };
    }
    return list;
  }, [chart, symbol, range, lastPrice]);

  // One chart instance per style; data and colours are pushed into it below.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const colors = palette(element);
    const instance = createChart(element, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text, fontFamily: getComputedStyle(element).fontFamily, fontSize: 11 },
      grid: { vertLines: { color: colors.line }, horzLines: { color: colors.line } },
      rightPriceScale: { borderColor: colors.line, scaleMargins: { top: 0.1, bottom: 0.22 } },
      timeScale: { borderColor: colors.line, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (value: number) => price(value) },
    });
    const main: ISeriesApi<SeriesType> = style === "candles"
      ? instance.addCandlestickSeries({ upColor: colors.up, downColor: colors.down, wickUpColor: colors.up, wickDownColor: colors.down, borderVisible: false })
      : style === "area"
        ? instance.addAreaSeries({ lineColor: colors.gold, topColor: `${colors.gold}55`, bottomColor: `${colors.gold}05`, lineWidth: 2 })
        : instance.addLineSeries({ color: colors.gold, lineWidth: 2 });
    const volume = instance.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
    instance.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    api.current = { chart: instance, main, volume };

    const onMove = (param: MouseEventParams) => {
      if (!param.time) { setHover(null); return; }
      const ms = fromChartTime(param.time);
      setHover((current) => (current?.time === ms ? current : candlesRef.current.find((candle) => candle.time === ms) ?? null));
    };
    instance.subscribeCrosshairMove(onMove);

    // Re-colour when the user switches light/dark.
    const observer = new MutationObserver(() => {
      const next = palette(element);
      instance.applyOptions({
        layout: { background: { type: ColorType.Solid, color: next.background }, textColor: next.text },
        grid: { vertLines: { color: next.line }, horzLines: { color: next.line } },
        rightPriceScale: { borderColor: next.line }, timeScale: { borderColor: next.line },
      });
      if (style === "candles") main.applyOptions({ upColor: next.up, downColor: next.down, wickUpColor: next.up, wickDownColor: next.down });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      instance.unsubscribeCrosshairMove(onMove);
      instance.remove();
      api.current = null;
    };
  }, [style]);

  useEffect(() => {
    candlesRef.current = candles;
    const current = api.current;
    const element = box.current;
    if (!current || !element) return;
    const colors = palette(element);
    current.main.setData(candles.map((candle) => (style === "candles"
      ? { time: toChartTime(candle.time), open: candle.open, high: candle.high, low: candle.low, close: candle.close }
      : { time: toChartTime(candle.time), value: candle.close })));
    current.volume.setData(candles.map((candle) => ({
      time: toChartTime(candle.time), value: candle.volume,
      color: `${candle.close >= candle.open ? colors.up : colors.down}55`,
    })));
    const previous = range === "1D" ? chart?.previousClose : null;
    const line = previous ? current.main.createPriceLine({ price: previous, color: colors.faint, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "Prev close" }) : null;
    current.chart.timeScale().fitContent();
    // Skip if the chart itself was already removed (unmount or style change); touching it would repaint a disposed canvas.
    return () => { if (line && api.current === current) current.main.removePriceLine(line); };
  }, [candles, style, range, chart]);

  // Esc leaves full screen; the page behind doesn't scroll while it's open.
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [full]);

  function zoom(factor: number) {
    const timeScale = api.current?.chart.timeScale();
    const visible = timeScale?.getVisibleLogicalRange();
    if (!timeScale || !visible) return;
    const center = (visible.from + visible.to) / 2;
    const half = Math.max(3, ((visible.to - visible.from) * factor) / 2);
    timeScale.setVisibleLogicalRange({ from: center - half, to: center + half });
  }

  const shown = hover ?? candles[candles.length - 1];
  return (
    <div className={`xt-chart ${full ? "is-full" : ""}`}>
      <div className="xt-chart-bar">
        {full && <strong className="xt-chart-title">{symbol} <small>NSE · {range}</small></strong>}
        <div className="xt-seg" role="group" aria-label="Chart range">
          {rangeList.map((item) => (
            <button aria-pressed={range === item} key={item} onClick={() => { setRange(item); setHover(null); }} type="button">{item}</button>
          ))}
        </div>
        <div className="xt-chart-controls">
          <div className="xt-seg" role="group" aria-label="Chart style">
            <button aria-pressed={style === "candles"} onClick={() => setStyle("candles")} title="Candles" type="button">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v12M12 2v12" stroke="currentColor" strokeWidth="1.2" /><rect x="2.5" y="5" width="3" height="6" fill="currentColor" /><rect x="10.5" y="4" width="3" height="5" fill="none" stroke="currentColor" /></svg>
            </button>
            <button aria-pressed={style === "area"} onClick={() => setStyle("area")} title="Area" type="button">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 12l4-5 3 3 6-7v11H1z" fill="currentColor" opacity=".25" /><path d="M1 12l4-5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            </button>
            <button aria-pressed={style === "line"} onClick={() => setStyle("line")} title="Line" type="button">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 12l4-5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            </button>
          </div>
          <div className="xt-seg" role="group" aria-label="Zoom">
            <button onClick={() => zoom(0.6)} title="Zoom in" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 10.5L14 14M5 7h4M7 5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg></button>
            <button onClick={() => zoom(1.6)} title="Zoom out" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 10.5L14 14M5 7h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg></button>
            <button onClick={() => api.current?.chart.timeScale().fitContent()} title="Fit all" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h12M2 8l3-3M2 8l3 3M14 8l-3-3M14 8l-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          </div>
          <button aria-label={full ? "Exit full screen" : "Open full-screen chart"} className="xt-chart-expand" onClick={() => setFull((value) => !value)} title={full ? "Exit full screen (Esc)" : "Full-screen chart"} type="button">
            {full
              ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
        </div>
      </div>

      <div className="xt-chart-legend">
        {shown ? (
          <>
            <span>{hover ? timeLabel(hover.time, range) : "Last"}</span>
            <span>O <b>{price(shown.open)}</b></span><span>H <b>{price(shown.high)}</b></span>
            <span>L <b>{price(shown.low)}</b></span><span>C <b className={shown.close >= shown.open ? "up" : "down"}>{price(shown.close)}</b></span>
            {shown.volume > 0 && <span>Vol <b>{shortNumber(shown.volume)}</b></span>}
          </>
        ) : <span>&nbsp;</span>}
      </div>

      <div aria-label={`${symbol} price chart, ${range}. Drag to move, scroll or pinch to zoom.`} className="xt-chart-plot" role="img">
        <div className="xt-chart-canvas" ref={box} />
        {(loading || failed || candles.length === 0) && (
          <div className="xt-chart-state">
            {loading ? <span className="xt-spinner" aria-label="Loading chart" /> : failed ? "Chart data is unavailable right now." : "No trades in this range yet."}
          </div>
        )}
      </div>
      <div className="xt-chart-foot">
        <p className="xt-chart-note">
          {candles.length > 0 && <>{count(candles.length)} {range === "1D" ? "5-minute" : range === "1W" ? "15-minute" : range === "5Y" ? "weekly" : "daily"} bars · </>}
          Drag to move · scroll or pinch to zoom · NSE, delayed
        </p>
        {full && actions && <div className="xt-chart-actions">{actions}</div>}
      </div>
    </div>
  );
}
