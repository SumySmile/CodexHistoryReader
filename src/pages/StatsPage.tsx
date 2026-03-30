import { useState } from 'react';
import { MessageSquare, FolderOpen, Wrench, Zap, ArrowDownUp, Activity } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';
import { StatsSkeleton } from '../components/shared/Skeleton';
import { SourceBadge } from '../components/shared/SourceBadge';
import { useStats } from '../hooks/useStats';
import { formatTokens } from '../lib/utils';

const COLORS = ['#7ec8a0', '#c878a0', '#5a9ec8', '#d08050', '#48a8b8', '#e06060', '#9878b8', '#48a890'];

type Range = 7 | 30 | 90 | 'all';

export function StatsPage() {
  const { stats, loading, error } = useStats();
  const [range, setRange] = useState<Range>(30);

  if (loading) {
    return <StatsSkeleton />;
  }

  if (error || !stats) {
    return (
      <div className="flex h-full items-center justify-center text-[#9aafa3]">
        <p>Failed to load stats: {error}</p>
      </div>
    );
  }

  const activityData = range === 'all'
    ? stats.dailyActivity
    : stats.dailyActivity.slice(-range);

  const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;
  const inputPct = totalTokens > 0 ? (stats.totalInputTokens / totalTokens) * 100 : 50;
  const outputPct = 100 - inputPct;

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <h1 className="mb-6 text-2xl font-bold text-[#2d3d34]">Usage Statistics</h1>

      <div className="mb-8 grid grid-cols-3 gap-4 xl:grid-cols-6">
        <SummaryCard icon={<MessageSquare size={20} />} label="Total Sessions" value={stats.totalSessions.toLocaleString()} color="#7ec8a0" />
        <SummaryCard icon={<ArrowDownUp size={20} />} label="Input Tokens" value={formatTokens(stats.totalInputTokens)} color="#5a9ec8" />
        <SummaryCard icon={<Activity size={20} />} label="Output Tokens" value={formatTokens(stats.totalOutputTokens)} color="#c878a0" />
        <SummaryCard icon={<Wrench size={20} />} label="Tool Calls" value={stats.totalToolCalls.toLocaleString()} color="#d08050" />
        <SummaryCard icon={<Zap size={20} />} label="Avg Tokens/Session" value={formatTokens(stats.avgTokensPerSession)} color="#48a8b8" />
        <SummaryCard icon={<FolderOpen size={20} />} label="Projects" value={String(stats.projectCount)} color="#9878b8" />
      </div>

      {stats.dailyActivity.length > 0 && (
        <div className="mb-6 rounded-lg border border-[#d0ddd5] bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium text-[#2d3d34]">Daily Activity</h2>
            <div className="flex gap-1">
              {([7, 30, 90, 'all'] as Range[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    range === r
                      ? 'bg-[#7ec8a0] text-white'
                      : 'bg-[#f0f5f2] text-[#6b8578] hover:bg-[#d4e6da]'
                  }`}
                >
                  {r === 'all' ? 'All' : `${r}d`}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={activityData}>
              <defs>
                <linearGradient id="colorSessions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7ec8a0" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7ec8a0" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#9aafa3', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#9aafa3', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #d0ddd5', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                labelStyle={{ color: '#6b8578' }}
              />
              <Area type="monotone" dataKey="sessions" stroke="#7ec8a0" fill="url(#colorSessions)" strokeWidth={2} />
              <Area type="monotone" dataKey="messages" stroke="#5a9ec8" fill="transparent" strokeDasharray="5 5" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {stats.sourceUsage.length > 0 && (
          <div className="rounded-lg border border-[#d0ddd5] bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-medium text-[#2d3d34]">Sources</h2>
            <div className="space-y-3">
              {stats.sourceUsage.map(source => {
                const sessionPct = stats.totalSessions > 0 ? (source.sessions / stats.totalSessions) * 100 : 0;
                return (
                  <div key={source.source} className="rounded-xl bg-[#f7fbf8] px-3 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <SourceBadge source={source.source} compact />
                      <div className="text-sm font-medium text-[#2d3d34]">{source.sessions.toLocaleString()} sessions</div>
                    </div>
                    <div className="mb-2 h-2 overflow-hidden rounded-full bg-[#e7f0eb]">
                      <div className="h-full rounded-full bg-[#7ec8a0]" style={{ width: `${sessionPct}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6b8578]">
                      <span>{formatTokens(source.tokens)} tokens</span>
                      <span>{source.toolCalls.toLocaleString()} tool calls</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {stats.modelUsage.length > 0 && (
          <div className="rounded-lg border border-[#d0ddd5] bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-medium text-[#2d3d34]">Model Usage (by tokens)</h2>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={180} height={200}>
                <PieChart>
                  <Pie
                    data={stats.modelUsage}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="count"
                    nameKey="model"
                  >
                    {stats.modelUsage.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #d0ddd5', borderRadius: 8 }}
                    formatter={(value: number | string | undefined) => formatTokens(Number(value) || 0)}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="min-w-0 flex-1 space-y-2">
                {stats.modelUsage.slice(0, 6).map((m, i) => (
                  <div key={i} className="flex min-w-0 items-center gap-2">
                    <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-[#2d3d34]">
                        {m.model.replace('claude-', '').split('-').slice(0, 2).join('-')}
                      </div>
                      <div className="text-xs text-[#9aafa3]">{formatTokens(m.count)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {stats.projectDistribution.length > 0 && (
          <div className="rounded-lg border border-[#d0ddd5] bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-medium text-[#2d3d34]">Projects</h2>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={stats.projectDistribution.slice(0, 10)} layout="vertical">
                <XAxis type="number" tick={{ fill: '#9aafa3', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="project"
                  width={120}
                  tick={{ fill: '#6b8578', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => v.replace(/--/g, '/').split('/').pop() || v}
                />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #d0ddd5', borderRadius: 8 }} />
                <Bar dataKey="sessions" fill="#7ec8a0" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {totalTokens > 0 && (
        <div className="mb-6 rounded-lg border border-[#d0ddd5] bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-medium text-[#2d3d34]">Token Breakdown</h2>
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-[#5a9ec8]">Input</span>
                <span className="text-[#6b8578]">{formatTokens(stats.totalInputTokens)} ({inputPct.toFixed(1)}%)</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[#f0f5f2]">
                <div className="h-full rounded-full bg-[#5a9ec8] transition-all" style={{ width: `${inputPct}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-[#c878a0]">Output</span>
                <span className="text-[#6b8578]">{formatTokens(stats.totalOutputTokens)} ({outputPct.toFixed(1)}%)</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[#f0f5f2]">
                <div className="h-full rounded-full bg-[#c878a0] transition-all" style={{ width: `${outputPct}%` }} />
              </div>
            </div>
            <div className="pt-1 text-xs text-[#9aafa3]">
              Output/Input ratio: {stats.totalInputTokens > 0 ? (stats.totalOutputTokens / stats.totalInputTokens).toFixed(2) : '—'}x
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-[#d0ddd5] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}18`, color }}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xl font-bold text-[#2d3d34]">{value}</div>
          <div className="text-xs text-[#9aafa3]">{label}</div>
        </div>
      </div>
    </div>
  );
}
