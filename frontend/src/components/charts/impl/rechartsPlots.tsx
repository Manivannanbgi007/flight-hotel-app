import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART_AXIS_TEXT, CHART_CURSOR, CHART_GRID } from '../palette';
import type { Datum } from '../types';

/**
 * The recharts part of the kit. Loaded on demand (React.lazy in Charts.tsx), so recharts never lands in the bundle of
 * a page without charts. Marks follow the data-viz rules: 2 px lines, bars at most 24 px with a 4 px rounded data end,
 * 10 % area wash, hairline solid grid, one Y axis, a crosshair tooltip that lists every series.
 */

export interface PlotSeries {
  key: string;
  label: string;
  color: string;
}

interface TooltipRow {
  label: string;
  color: string;
  value: string;
}

function PlotTooltip({ heading, rows, shape }: { heading: string; rows: TooltipRow[]; shape: 'line' | 'square' }) {
  return (
    <div className="min-w-40 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
      <p className="mb-1.5 font-semibold text-slate-500">{heading}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span aria-hidden="true" className={shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-[2px]'} style={{ background: row.color }} />
              {row.label}
            </span>
            <span className="font-bold tabular-nums text-slate-900">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TooltipPayloadItem {
  dataKey?: unknown;
  value?: unknown;
  name?: unknown;
  payload?: Record<string, unknown>;
}

export interface CartesianPlotProps {
  kind: 'line' | 'area' | 'bar';
  width: number;
  height: number;
  data: Datum[];
  xKey: string;
  series: PlotSeries[];
  stacked?: boolean;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  formatX: (value: string) => string;
  /** Whole numbers only on the Y axis. */
  integer?: boolean;
  yAxisWidth?: number;
  animate: boolean;
}

/** Line, area and bar charts (one Y axis, categories along X). */
export function CartesianPlot(props: CartesianPlotProps) {
  const { kind, width, height, data, xKey, series, stacked, formatValue, formatTick, formatX, integer, yAxisWidth = 56, animate } = props;
  const common = { width, height, data, margin: { top: 8, right: 8, bottom: 0, left: 0 }, accessibilityLayer: false };
  const shape = kind === 'line' ? 'line' : 'square';

  const tooltip = (
    <Tooltip
      cursor={kind === 'bar' ? { fill: 'rgb(148 163 184 / 0.12)' } : { stroke: CHART_CURSOR, strokeWidth: 1 }}
      isAnimationActive={false}
      content={({ active, payload, label }) => {
        const items = (payload ?? []) as readonly TooltipPayloadItem[];
        if (!active || items.length === 0) return null;
        const rows = series.map((s) => {
          const item = items.find((entry) => entry.dataKey === s.key);
          return { label: s.label, color: s.color, value: formatValue(Number(item?.value ?? 0)) };
        });
        return <PlotTooltip heading={formatX(String(label ?? ''))} rows={stacked && kind !== 'line' ? [...rows].reverse() : rows} shape={shape} />;
      }}
    />
  );

  const axes = [
    <CartesianGrid key="grid" vertical={false} stroke={CHART_GRID} />,
    <XAxis
      key="x"
      dataKey={xKey}
      tickFormatter={(value: unknown) => formatX(String(value))}
      tickLine={false}
      axisLine={{ stroke: CHART_GRID }}
      tick={{ fill: CHART_AXIS_TEXT, fontSize: 12 }}
      tickMargin={8}
      minTickGap={16}
      interval="preserveStartEnd"
    />,
    <YAxis
      key="y"
      tickFormatter={(value: unknown) => formatTick(Number(value))}
      tickLine={false}
      axisLine={false}
      tick={{ fill: CHART_AXIS_TEXT, fontSize: 12 }}
      width={yAxisWidth}
      allowDecimals={!integer}
    />,
  ];

  if (kind === 'line') {
    return (
      <LineChart {...common}>
        {axes}
        {tooltip}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
            isAnimationActive={animate}
            animationDuration={700}
          />
        ))}
      </LineChart>
    );
  }

  if (kind === 'area') {
    return (
      <AreaChart {...common}>
        {axes}
        {tooltip}
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? 'stack' : undefined}
            stroke={s.color}
            strokeWidth={2}
            fill={s.color}
            fillOpacity={0.1}
            activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
            isAnimationActive={animate}
            animationDuration={700}
          />
        ))}
      </AreaChart>
    );
  }

  const last = series.length - 1;
  return (
    <BarChart {...common} barCategoryGap="24%" barGap={2}>
      {axes}
      {tooltip}
      {series.map((s, index) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.label}
          stackId={stacked ? 'stack' : undefined}
          fill={s.color}
          maxBarSize={24}
          radius={!stacked || index === last ? [4, 4, 0, 0] : 0}
          {...(stacked ? { stroke: '#ffffff', strokeWidth: 1 } : {})}
          isAnimationActive={animate}
          animationDuration={600}
        />
      ))}
    </BarChart>
  );
}

export interface DonutPlotProps {
  width: number;
  height: number;
  slices: { label: string; value: number; color: string }[];
  formatValue: (value: number) => string;
  animate: boolean;
}

/** Donut (part of a whole, few slices): 2 px surface gaps between slices, tooltip with value and share. */
export function DonutPlot({ width, height, slices, formatValue, animate }: DonutPlotProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const size = Math.min(width, height);
  return (
    <PieChart width={width} height={height} accessibilityLayer={false}>
      <Tooltip
        isAnimationActive={false}
        content={({ active, payload }) => {
          const item = ((payload ?? []) as readonly TooltipPayloadItem[])[0];
          if (!active || !item) return null;
          const slice = slices.find((s) => s.label === item.name);
          if (!slice) return null;
          const share = total > 0 ? Math.round((slice.value / total) * 1000) / 10 : 0;
          return <PlotTooltip heading={slice.label} rows={[{ label: `${share}% of total`, color: slice.color, value: formatValue(slice.value) }]} shape="square" />;
        }}
      />
      <Pie
        data={slices}
        dataKey="value"
        nameKey="label"
        cx="50%"
        cy="50%"
        innerRadius={size * 0.32}
        outerRadius={size * 0.46}
        paddingAngle={slices.length > 1 ? 1 : 0}
        stroke="#ffffff"
        strokeWidth={2}
        startAngle={90}
        endAngle={-270}
        isAnimationActive={animate}
        animationDuration={700}
      >
        {slices.map((slice) => <Cell key={slice.label} fill={slice.color} />)}
      </Pie>
    </PieChart>
  );
}
