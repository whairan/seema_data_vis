import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ScatterChart, Scatter, LineChart, Line, BarChart, Bar,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell, ReferenceLine,
} from 'recharts'

const API = 'http://localhost:8000'

const COLORS = [
  '#e94560', '#0f3460', '#6366f1', '#f59e0b', '#10b981',
  '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4',
]

// Correlation color scale (blue negative, white zero, red positive)
function corrColor(value) {
  if (value === null || value === undefined) return 'rgba(141,153,174,0.05)'
  const abs = Math.abs(value)
  if (value > 0) return `rgba(233, 69, 96, ${abs * 0.8 + 0.1})`
  if (value < 0) return `rgba(99, 102, 241, ${abs * 0.8 + 0.1})`
  return 'rgba(141,153,174,0.1)'
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,10,18,0.95)', border: '1px solid rgba(233,69,96,0.2)',
      borderRadius: 8, padding: '10px 14px', fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, color: '#e8e8ed', backdropFilter: 'blur(10px)',
    }}>
      {label && <div style={{ color: '#8d99ae', marginBottom: 4, fontSize: 10 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: '#8d99ae' }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>
            {typeof p.value === 'number' ? p.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [datasets, setDatasets] = useState({})
  const [activeDataset, setActiveDataset] = useState(null)
  const [profile, setProfile] = useState(null)
  const [correlations, setCorrelations] = useState(null)
  const [pairwise, setPairwise] = useState(null)
  const [data, setData] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState({})
  const [corrMethod, setCorrMethod] = useState('pearson')
  const [selectedPair, setSelectedPair] = useState(null)
  const [chartType, setChartType] = useState('scatter')
  const [xAxis, setXAxis] = useState('')
  const [yAxes, setYAxes] = useState([])
  const [activeTab, setActiveTab] = useState('correlations')
  const fileRef = useRef()

  // Fetch dataset list
  const fetchDatasets = useCallback(async () => {
    try {
      const res = await fetch(`${API}/datasets`)
      const data = await res.json()
      setDatasets(data)
      if (!activeDataset && Object.keys(data).length > 0) {
        setActiveDataset(Object.keys(data)[0])
      }
    } catch (e) { console.error(e) }
  }, [activeDataset])

  useEffect(() => { fetchDatasets() }, [])

  // Load dataset details when active changes
  useEffect(() => {
    if (!activeDataset) return
    const load = async () => {
      setLoading(l => ({ ...l, profile: true, correlations: true, data: true }))
      try {
        const [profRes, corrRes, dataRes] = await Promise.all([
          fetch(`${API}/profile/${activeDataset}`),
          fetch(`${API}/correlations/${activeDataset}?method=${corrMethod}`),
          fetch(`${API}/data/${activeDataset}?limit=500`),
        ])
        const prof = await profRes.json()
        const corr = await corrRes.json()
        const d = await dataRes.json()
        setProfile(prof)
        setCorrelations(corr)
        setData(d.data)
        setSelectedPair(null)
        setPairwise(null)

        // Auto-select axes
        const numCols = prof.columns.filter(c => c.type === 'numeric').map(c => c.name)
        const catCols = prof.columns.filter(c => c.type === 'categorical').map(c => c.name)
        setXAxis(catCols[0] || numCols[0] || '')
        setYAxes(numCols.length > 0 ? [numCols[0]] : [])
      } catch (e) { console.error(e) }
      setLoading(l => ({ ...l, profile: false, correlations: false, data: false }))
    }
    load()
  }, [activeDataset, corrMethod])

  // Fetch pairwise when pair selected
  useEffect(() => {
    if (!selectedPair || !activeDataset) return
    const load = async () => {
      setLoading(l => ({ ...l, pairwise: true }))
      try {
        const res = await fetch(
          `${API}/pairwise/${activeDataset}?col_a=${encodeURIComponent(selectedPair[0])}&col_b=${encodeURIComponent(selectedPair[1])}`
        )
        const data = await res.json()
        setPairwise(data)
      } catch (e) { console.error(e) }
      setLoading(l => ({ ...l, pairwise: false }))
    }
    load()
  }, [selectedPair, activeDataset])

  // Fetch AI summary
  const fetchSummary = useCallback(async () => {
    if (!activeDataset) return
    setLoading(l => ({ ...l, summary: true }))
    setSummary(null)
    try {
      const res = await fetch(`${API}/summary/${activeDataset}`)
      const data = await res.json()
      setSummary(data)
    } catch (e) { console.error(e) }
    setLoading(l => ({ ...l, summary: false }))
  }, [activeDataset])

  useEffect(() => {
    if (activeTab === 'summary' && !summary) fetchSummary()
  }, [activeTab, activeDataset])

  // File upload
  const handleUpload = useCallback(async (file) => {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(`${API}/upload`, { method: 'POST', body: form })
      const result = await res.json()
      setActiveDataset(result.name)
      fetchDatasets()
    } catch (e) { console.error(e) }
  }, [fetchDatasets])

  const numericCols = useMemo(() =>
    profile?.columns?.filter(c => c.type === 'numeric').map(c => c.name) || [], [profile])

  const allCols = useMemo(() =>
    profile?.columns?.map(c => c.name) || [], [profile])

  const toggleYAxis = (col) => {
    setYAxes(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col])
  }

  // =========== RENDER ===========

  const s = {
    app: { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#08080f' },
    header: {
      padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: '1px solid rgba(141,153,174,0.08)', background: 'rgba(8,8,15,0.9)',
      backdropFilter: 'blur(20px)', position: 'sticky', top: 0, zIndex: 100,
    },
    logo: { fontSize: 17, fontWeight: 700, letterSpacing: '-0.5px', display: 'flex', alignItems: 'center', gap: 10 },
    logoMark: {
      width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #e94560, #6366f1)', fontSize: 12, fontWeight: 800,
    },
    body: { display: 'flex', flex: 1, overflow: 'hidden' },
    sidebar: {
      width: 220, minWidth: 220, borderRight: '1px solid rgba(141,153,174,0.08)',
      padding: '16px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
    },
    main: { flex: 1, overflow: 'auto', padding: '20px 24px' },
    label: {
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px',
      color: '#555b6e', marginBottom: 6,
    },
    chip: (active) => ({
      padding: '5px 10px', borderRadius: 20, border: '1px solid',
      borderColor: active ? 'rgba(233,69,96,0.4)' : 'rgba(141,153,174,0.12)',
      background: active ? 'rgba(233,69,96,0.1)' : 'transparent',
      color: active ? '#e94560' : '#8d99ae', cursor: 'pointer', fontSize: 11,
      fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap',
    }),
    tab: (active) => ({
      padding: '8px 16px', borderRadius: 6, border: 'none',
      background: active ? 'rgba(233,69,96,0.12)' : 'transparent',
      color: active ? '#e94560' : '#8d99ae', cursor: 'pointer', fontSize: 12,
      fontFamily: "'DM Sans', sans-serif", fontWeight: active ? 600 : 400, transition: 'all 0.15s',
    }),
    card: {
      background: 'rgba(141,153,174,0.03)', borderRadius: 12,
      border: '1px solid rgba(141,153,174,0.08)', padding: 20, marginBottom: 16,
    },
    statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 },
    statBox: {
      background: 'rgba(141,153,174,0.04)', borderRadius: 8, padding: '10px 12px',
      border: '1px solid rgba(141,153,174,0.06)',
    },
    mono: { fontFamily: "'JetBrains Mono', monospace" },
  }

  return (
    <div style={s.app}>
      {/* HEADER */}
      <div style={s.header}>
        <div style={s.logo}>
          <div style={s.logoMark}>S</div>
          <span>Sima</span>
          <span style={{ fontSize: 10, color: '#555b6e', marginLeft: 4, fontWeight: 400 }}>data intelligence</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {activeDataset && (
            <span style={{ ...s.mono, fontSize: 11, color: '#555b6e' }}>
              {activeDataset} · {profile?.shape?.rows || '...'} rows
            </span>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(233,69,96,0.3)',
              background: 'rgba(233,69,96,0.08)', color: '#e94560', cursor: 'pointer',
              fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
            }}
          >
            Upload CSV / JSON
          </button>
          <input ref={fileRef} type="file" accept=".csv,.json,.tsv"
            onChange={e => handleUpload(e.target.files?.[0])} style={{ display: 'none' }} />
        </div>
      </div>

      <div style={s.body}>
        {/* SIDEBAR */}
        <div style={s.sidebar}>
          <div>
            <div style={s.label}>Datasets</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(datasets).map(([name, info]) => (
                <button key={name} onClick={() => { setActiveDataset(name); setSummary(null); }}
                  style={{
                    ...s.chip(activeDataset === name), display: 'block', textAlign: 'left',
                    borderRadius: 6, padding: '8px 10px',
                  }}>
                  <div style={{ fontSize: 12, fontWeight: activeDataset === name ? 600 : 400 }}>{name}</div>
                  <div style={{ fontSize: 10, color: '#555b6e', marginTop: 2 }}>
                    {info.rows} rows · {info.columns} cols
                  </div>
                </button>
              ))}
            </div>
          </div>

          {profile && (
            <>
              <div>
                <div style={s.label}>X Axis</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {allCols.map(col => (
                    <button key={col} style={s.chip(xAxis === col)} onClick={() => setXAxis(col)}>
                      {col}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={s.label}>Y Axes</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {numericCols.map(col => (
                    <button key={col} style={s.chip(yAxes.includes(col))} onClick={() => toggleYAxis(col)}>
                      {col}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={s.label}>Chart Type</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {['bar', 'line', 'area', 'scatter'].map(t => (
                    <button key={t} style={s.chip(chartType === t)} onClick={() => setChartType(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* MAIN */}
        <div style={s.main}>
          {/* TABS */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {[
              { id: 'correlations', label: 'Correlations' },
              { id: 'explorer', label: 'Explorer' },
              { id: 'summary', label: 'AI Summary' },
            ].map(tab => (
              <button key={tab.id} style={s.tab(activeTab === tab.id)}
                onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* CORRELATION TAB */}
          {activeTab === 'correlations' && correlations && !correlations.error && (
            <div>
              {/* Method selector */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center' }}>
                <span style={{ ...s.label, marginBottom: 0, marginRight: 8 }}>Method</span>
                {['pearson', 'spearman', 'kendall'].map(m => (
                  <button key={m} style={s.chip(corrMethod === m)} onClick={() => setCorrMethod(m)}>
                    {m}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: selectedPair ? '1fr 1fr' : '1fr', gap: 16 }}>
                {/* Heatmap */}
                <div style={s.card}>
                  <div style={{ ...s.label, marginBottom: 12 }}>Correlation Matrix</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', ...s.mono, fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: 6 }} />
                          {correlations.columns.map(col => (
                            <th key={col} style={{
                              padding: '6px 8px', color: '#8d99ae', fontWeight: 500, fontSize: 10,
                              transform: 'rotate(-45deg)', transformOrigin: 'center center',
                              whiteSpace: 'nowrap', height: 60,
                            }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {correlations.columns.map((row, i) => (
                          <tr key={row}>
                            <td style={{ padding: '6px 8px', color: '#8d99ae', fontWeight: 500, fontSize: 10, whiteSpace: 'nowrap' }}>
                              {row}
                            </td>
                            {correlations.columns.map((col, j) => {
                              const val = correlations.matrix[i][j]
                              const isSelected = selectedPair &&
                                ((selectedPair[0] === row && selectedPair[1] === col) ||
                                 (selectedPair[0] === col && selectedPair[1] === row))
                              return (
                                <td key={col}
                                  onClick={() => i !== j && setSelectedPair([row, col])}
                                  style={{
                                    padding: '6px 8px', background: corrColor(i === j ? null : val),
                                    cursor: i === j ? 'default' : 'pointer', textAlign: 'center',
                                    color: Math.abs(val) > 0.5 ? '#fff' : '#8d99ae',
                                    fontWeight: Math.abs(val) > 0.7 ? 600 : 400, fontSize: 10,
                                    border: isSelected ? '2px solid #e94560' : '1px solid rgba(141,153,174,0.05)',
                                    borderRadius: 3, transition: 'all 0.15s',
                                    minWidth: 48,
                                  }}>
                                  {i === j ? '1' : val?.toFixed(2)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pairwise detail */}
                {selectedPair && (
                  <div style={s.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={s.label}>
                        {selectedPair[0]} vs {selectedPair[1]}
                      </div>
                      <button onClick={() => { setSelectedPair(null); setPairwise(null); }}
                        style={{ background: 'none', border: 'none', color: '#555b6e', cursor: 'pointer', fontSize: 14 }}>
                        ✕
                      </button>
                    </div>
                    {loading.pairwise ? (
                      <div style={{ color: '#555b6e', fontSize: 12, padding: 20, textAlign: 'center' }}>Analyzing...</div>
                    ) : pairwise ? (
                      <>
                        <div style={{ ...s.statGrid, marginBottom: 16 }}>
                          {pairwise.pearson && (
                            <div style={s.statBox}>
                              <div style={{ fontSize: 10, color: '#555b6e' }}>Pearson r</div>
                              <div style={{ ...s.mono, fontSize: 16, fontWeight: 600, color: '#e8e8ed' }}>
                                {pairwise.pearson.r}
                              </div>
                              <div style={{ fontSize: 9, color: pairwise.pearson.p < 0.05 ? '#10b981' : '#f59e0b' }}>
                                p={pairwise.pearson.p < 0.001 ? '<0.001' : pairwise.pearson.p}
                              </div>
                            </div>
                          )}
                          {pairwise.spearman && (
                            <div style={s.statBox}>
                              <div style={{ fontSize: 10, color: '#555b6e' }}>Spearman ρ</div>
                              <div style={{ ...s.mono, fontSize: 16, fontWeight: 600, color: '#e8e8ed' }}>
                                {pairwise.spearman.r}
                              </div>
                              <div style={{ fontSize: 9, color: pairwise.spearman.p < 0.05 ? '#10b981' : '#f59e0b' }}>
                                p={pairwise.spearman.p < 0.001 ? '<0.001' : pairwise.spearman.p}
                              </div>
                            </div>
                          )}
                          {pairwise.regression && (
                            <>
                              <div style={s.statBox}>
                                <div style={{ fontSize: 10, color: '#555b6e' }}>R²</div>
                                <div style={{ ...s.mono, fontSize: 16, fontWeight: 600, color: '#e8e8ed' }}>
                                  {pairwise.regression.r_squared}
                                </div>
                              </div>
                              <div style={s.statBox}>
                                <div style={{ fontSize: 10, color: '#555b6e' }}>Slope</div>
                                <div style={{ ...s.mono, fontSize: 14, fontWeight: 600, color: '#e8e8ed' }}>
                                  {pairwise.regression.slope.toFixed(4)}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Scatter plot */}
                        {pairwise.scatter && (
                          <ResponsiveContainer width="100%" height={280}>
                            <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(141,153,174,0.08)" />
                              <XAxis dataKey="x" name={selectedPair[0]} type="number"
                                tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                                axisLine={{ stroke: 'rgba(141,153,174,0.15)' }} tickLine={false}
                                label={{ value: selectedPair[0], position: 'bottom', fill: '#555b6e', fontSize: 10, offset: 15 }}
                              />
                              <YAxis dataKey="y" name={selectedPair[1]} type="number"
                                tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                                axisLine={false} tickLine={false}
                                label={{ value: selectedPair[1], angle: -90, position: 'insideLeft', fill: '#555b6e', fontSize: 10 }}
                              />
                              <Tooltip content={<CustomTooltip />} />
                              <Scatter data={pairwise.scatter} fill="#e94560" fillOpacity={0.6} r={5} />
                            </ScatterChart>
                          </ResponsiveContainer>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Notable correlations list */}
              {correlations.notable_correlations?.length > 0 && (
                <div style={{ ...s.card, marginTop: 0 }}>
                  <div style={{ ...s.label, marginBottom: 10 }}>Notable Correlations</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {correlations.notable_correlations.slice(0, 8).map((c, i) => (
                      <div key={i}
                        onClick={() => setSelectedPair([c.col_a, c.col_b])}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                          borderRadius: 8, background: 'rgba(141,153,174,0.04)', cursor: 'pointer',
                          border: '1px solid rgba(141,153,174,0.06)', transition: 'all 0.15s',
                        }}>
                        <span style={{
                          ...s.mono, fontSize: 14, fontWeight: 700, minWidth: 50,
                          color: c.direction === 'positive' ? '#e94560' : '#6366f1',
                        }}>
                          {c.correlation > 0 ? '+' : ''}{c.correlation.toFixed(2)}
                        </span>
                        <span style={{ fontSize: 12, color: '#e8e8ed' }}>
                          {c.col_a} ↔ {c.col_b}
                        </span>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 10,
                          background: c.strength === 'strong' ? 'rgba(233,69,96,0.12)' :
                            c.strength === 'moderate' ? 'rgba(245,158,11,0.12)' : 'rgba(141,153,174,0.08)',
                          color: c.strength === 'strong' ? '#e94560' :
                            c.strength === 'moderate' ? '#f59e0b' : '#8d99ae',
                        }}>
                          {c.strength}
                        </span>
                        {c.significant && (
                          <span style={{ fontSize: 9, color: '#10b981' }}>significant</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* EXPLORER TAB */}
          {activeTab === 'explorer' && data && (
            <div>
              {/* Chart */}
              {xAxis && yAxes.length > 0 && (
                <div style={s.card}>
                  <div style={{ ...s.label, marginBottom: 12 }}>
                    {chartType.toUpperCase()} · {xAxis} vs {yAxes.join(', ')}
                  </div>
                  <ResponsiveContainer width="100%" height={380}>
                    {chartType === 'scatter' ? (
                      <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(141,153,174,0.08)" vertical={false} />
                        <XAxis dataKey={xAxis} type="number" name={xAxis}
                          tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                          axisLine={{ stroke: 'rgba(141,153,174,0.15)' }} tickLine={false} />
                        <YAxis name={yAxes[0]}
                          tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                          axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        {yAxes.map((y, i) => (
                          <Scatter key={y} name={y} data={data} dataKey={y}
                            fill={COLORS[i % COLORS.length]} fillOpacity={0.7} r={5} />
                        ))}
                      </ScatterChart>
                    ) : chartType === 'line' ? (
                      <LineChart data={data} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(141,153,174,0.08)" vertical={false} />
                        <XAxis dataKey={xAxis}
                          tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                          axisLine={{ stroke: 'rgba(141,153,174,0.15)' }} tickLine={false} />
                        <YAxis tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                          axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: '#8d99ae' }} />
                        {yAxes.map((y, i) => (
                          <Line key={y} dataKey={y} name={y} stroke={COLORS[i % COLORS.length]}
                            strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5, stroke: '#08080f', strokeWidth: 2 }} />
                        ))}
                      </LineChart>
                    ) : chartType === 'area' ? (
                      <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(141,153,174,0.08)" vertical={false} />
                        <XAxis dataKey={xAxis}
                          tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                          axisLine={{ stroke: 'rgba(141,153,174,0.15)' }} tickLine={false} />
                        <YAxis tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                          axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: '#8d99ae' }} />
                        {yAxes.map((y, i) => (
                          <Area key={y} dataKey={y} name={y} stroke={COLORS[i % COLORS.length]}
                            fill={COLORS[i % COLORS.length]} fillOpacity={0.12} strokeWidth={2} />
                        ))}
                      </AreaChart>
                    ) : (
                      <BarChart data={data} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(141,153,174,0.08)" vertical={false} />
                        <XAxis dataKey={xAxis}
                          tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                          axisLine={{ stroke: 'rgba(141,153,174,0.15)' }} tickLine={false}
                          angle={data.length > 6 ? -35 : 0} textAnchor={data.length > 6 ? 'end' : 'middle'} />
                        <YAxis tick={{ fill: '#8d99ae', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                          axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: '#8d99ae' }} />
                        {yAxes.map((y, i) => (
                          <Bar key={y} dataKey={y} name={y} fill={COLORS[i % COLORS.length]}
                            radius={[4, 4, 0, 0]} fillOpacity={0.85} />
                        ))}
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}

              {/* Column Stats */}
              <div style={s.card}>
                <div style={{ ...s.label, marginBottom: 10 }}>Column Profiles</div>
                <div style={s.statGrid}>
                  {profile?.columns?.filter(c => c.type === 'numeric').map(col => (
                    <div key={col.name} style={s.statBox}>
                      <div style={{ fontSize: 11, color: '#e8e8ed', fontWeight: 500, marginBottom: 6 }}>
                        {col.name}
                      </div>
                      <div style={{ ...s.mono, fontSize: 10, color: '#8d99ae', lineHeight: 1.8 }}>
                        <div>μ {col.stats.mean.toLocaleString()}</div>
                        <div>σ {col.stats.std.toLocaleString()}</div>
                        <div>range [{col.stats.min}, {col.stats.max}]</div>
                        <div style={{ color: '#555b6e' }}>{col.distribution?.type || 'unknown'}</div>
                        {col.outliers?.count > 0 && (
                          <div style={{ color: '#f59e0b' }}>{col.outliers.count} outliers</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Data Table */}
              <div style={s.card}>
                <div style={{ ...s.label, marginBottom: 10 }}>Data Preview</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', ...s.mono, fontSize: 11 }}>
                    <thead>
                      <tr>
                        {allCols.map(col => (
                          <th key={col} style={{
                            padding: '6px 10px', textAlign: 'left', color: '#555b6e', fontWeight: 600,
                            fontSize: 10, borderBottom: '1px solid rgba(141,153,174,0.08)',
                            background: 'rgba(141,153,174,0.03)', whiteSpace: 'nowrap',
                          }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          {allCols.map(col => (
                            <td key={col} style={{
                              padding: '5px 10px', whiteSpace: 'nowrap',
                              color: typeof row[col] === 'number' ? '#e8e8ed' : '#8d99ae',
                              borderBottom: '1px solid rgba(141,153,174,0.04)',
                            }}>
                              {typeof row[col] === 'number' ? row[col].toLocaleString() : row[col]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* AI SUMMARY TAB */}
          {activeTab === 'summary' && (
            <div>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={s.label}>AI Data Intelligence Report</div>
                  <button onClick={fetchSummary} style={{
                    padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(233,69,96,0.3)',
                    background: 'rgba(233,69,96,0.08)', color: '#e94560', cursor: 'pointer',
                    fontSize: 11, fontFamily: 'inherit',
                  }}>
                    {loading.summary ? 'Analyzing...' : 'Regenerate'}
                  </button>
                </div>

                {loading.summary ? (
                  <div style={{ padding: 40, textAlign: 'center' }}>
                    <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.3 }}>◇</div>
                    <div style={{ color: '#555b6e', fontSize: 12 }}>Analyzing your data...</div>
                  </div>
                ) : summary ? (
                  <>
                    <div style={{
                      fontSize: 14, lineHeight: 1.8, color: '#e8e8ed', padding: '16px 20px',
                      background: 'rgba(141,153,174,0.04)', borderRadius: 8,
                      borderLeft: '3px solid #e94560',
                    }}>
                      {summary.summary}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 10, color: '#555b6e' }}>
                      Source: {summary.source === 'ai' ? 'Claude AI' : 'Statistical engine'}
                    </div>
                  </>
                ) : (
                  <div style={{ color: '#555b6e', fontSize: 12, padding: 20, textAlign: 'center' }}>
                    Click "Regenerate" to generate an AI summary of this dataset.
                  </div>
                )}
              </div>

              {/* Raw stats */}
              {summary?.raw_stats && (
                <div style={s.card}>
                  <div style={{ ...s.label, marginBottom: 10 }}>Raw Statistical Profile</div>
                  <pre style={{
                    ...s.mono, fontSize: 10, color: '#8d99ae', lineHeight: 1.6,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: 'rgba(141,153,174,0.04)', padding: 16, borderRadius: 8,
                  }}>
                    {summary.raw_stats}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!activeDataset && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, opacity: 0.15, marginBottom: 16 }}>◇</div>
                <div style={{ fontSize: 14, color: '#555b6e' }}>Upload a dataset or select a sample to begin</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
