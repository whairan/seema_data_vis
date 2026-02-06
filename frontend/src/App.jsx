import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ScatterChart, Scatter, LineChart, Line, BarChart, Bar,
  AreaChart, Area, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'

const API = 'http://localhost:8000'
const COLORS = ['#e94560','#6366f1','#10b981','#f59e0b','#ec4899','#14b8a6','#f97316','#8b5cf6','#06b6d4','#84cc16']

function corrColor(v) {
  if (v == null) return 'rgba(141,153,174,0.05)'
  const a = Math.abs(v)
  return v > 0 ? `rgba(233,69,96,${a*0.8+0.1})` : `rgba(99,102,241,${a*0.8+0.1})`
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'rgba(10,10,18,0.95)', border:'1px solid rgba(233,69,96,0.2)',
      borderRadius:8, padding:'10px 14px', fontFamily:"'JetBrains Mono',monospace",
      fontSize:11, color:'#e8e8ed', backdropFilter:'blur(10px)', maxWidth:300 }}>
      {label != null && <div style={{ color:'#8d99ae', marginBottom:4, fontSize:10 }}>{label}</div>}
      {payload.map((p,i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
          <span style={{ width:6, height:6, borderRadius:'50%', background:p.color, flexShrink:0 }} />
          <span style={{ color:'#8d99ae' }}>{p.name}:</span>
          <span style={{ fontWeight:600 }}>
            {typeof p.value === 'number' ? p.value.toLocaleString(undefined,{maximumFractionDigits:2}) : String(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function Badge({ type }) {
  const c = { numeric:['#','#e94560'], categorical:['A','#6366f1'], datetime:['⏱','#10b981'],
              id:['ID','#555b6e'], high_cardinality:['A+','#f59e0b'] }[type] || ['?','#555b6e']
  return <span style={{ fontSize:8, padding:'1px 4px', borderRadius:3,
    background:`${c[1]}18`, color:c[1], fontWeight:700, marginLeft:4 }}>{c[0]}</span>
}

export default function App() {
  // ── Core state ──
  const [datasetList, setDatasetList] = useState({})
  const [hiddenSets, setHiddenSets] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('sima_hidden') || '[]')) }
    catch { return new Set() }
  })
  const [active, setActive] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('explorer')
  const fileRef = useRef()

  // ── Chart config: fully resettable ──
  const [chartType, setChartType] = useState('bar')
  const [xCol, setXCol] = useState('')
  const [yCols, setYCols] = useState([])
  const [zCol, setZCol] = useState('')
  const [xLabel, setXLabel] = useState('')
  const [yLabel, setYLabel] = useState('')
  const [zLabel, setZLabel] = useState('')
  const [editingLabels, setEditingLabels] = useState(false)

  // ── Correlation state ──
  const [corrMethod, setCorrMethod] = useState('pearson')
  const [correlations, setCorrelations] = useState(null)
  const [selectedPair, setSelectedPair] = useState(null)
  const [pairwise, setPairwise] = useState(null)

  // ── Summary ──
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  // ── Derived ──
  const cols = analysis?.columns || { numeric:[], categorical:[], datetime:[], id:[], high_cardinality:[] }
  const profile = analysis?.profile || null
  const suggestions = analysis?.suggestions || []
  const data = analysis?.data || []
  const totalRows = analysis?.total_rows || 0

  const allPlottable = useMemo(() =>
    [...cols.categorical, ...cols.datetime, ...cols.numeric, ...cols.high_cardinality],
    [cols])
  const numericCols = useMemo(() => cols.numeric, [cols])
  const allProfileCols = useMemo(() => profile?.columns?.map(c => c.name) || [], [profile])

  const colType = useMemo(() => {
    const m = {}
    for (const [t, arr] of Object.entries(cols)) for (const c of arr) m[c] = t
    return m
  }, [cols])

  const visibleDatasets = useMemo(() =>
    Object.entries(datasetList).filter(([n]) => !hiddenSets.has(n)),
    [datasetList, hiddenSets])

  // ── Data fetching ──

  const fetchDatasets = useCallback(async () => {
    try {
      const list = await (await fetch(`${API}/datasets`)).json()
      setDatasetList(list)
      // Prune hidden sets that no longer exist
      setHiddenSets(prev => {
        const valid = new Set([...prev].filter(n => n in list))
        if (valid.size !== prev.size) localStorage.setItem('sima_hidden', JSON.stringify([...valid]))
        return valid
      })
    }
    catch (e) { console.error(e) }
  }, [])

  useEffect(() => { fetchDatasets() }, [fetchDatasets])

  // Central analysis loader — COMPLETELY resets chart state
  const loadAnalysis = useCallback(async (name) => {
    setLoading(true)
    setError(null)
    // Nuke all stale state
    setAnalysis(null)
    setCorrelations(null)
    setSelectedPair(null)
    setPairwise(null)
    setSummary(null)
    setXCol('')
    setYCols([])
    setZCol('')
    setXLabel('')
    setYLabel('')
    setZLabel('')
    setEditingLabels(false)

    try {
      const res = await fetch(`${API}/analyze/${encodeURIComponent(name)}`)
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(t || `HTTP ${res.status}`)
      }
      const result = await res.json()
      setAnalysis(result)
      setCorrelations(result.correlations)

      // Auto-configure from best suggestion
      const s = result.suggestions?.[0]
      if (s) {
        setChartType(s.type || 'bar')
        setXCol(s.x || '')
        setYCols(s.y || [])
        setZCol(s.z || '')
      } else {
        const c = result.columns || {}
        const cats = [...(c.categorical||[]), ...(c.datetime||[])]
        const nums = c.numeric || []
        if (cats.length && nums.length) {
          setChartType('bar'); setXCol(cats[0]); setYCols([nums[0]])
        } else if (nums.length >= 2) {
          setChartType('scatter'); setXCol(nums[0]); setYCols([nums[1]])
        }
      }
    } catch (e) {
      console.error('Analyze failed:', e)
      setError(`Failed to analyze "${name}". Is the backend running on ${API}? Error: ${e.message}`)
    }
    setLoading(false)
  }, [])

  const switchDataset = useCallback((name) => {
    setActive(name)
    setTab('explorer')
    loadAnalysis(name)
  }, [loadAnalysis])

  // Auto-load first visible dataset
  useEffect(() => {
    if (!active && visibleDatasets.length > 0) switchDataset(visibleDatasets[0][0])
  }, [visibleDatasets, active, switchDataset])

  // Upload
  const handleUpload = useCallback(async (file) => {
    if (!file) return
    const form = new FormData(); form.append('file', file)
    try {
      const r = await (await fetch(`${API}/upload`, { method:'POST', body:form })).json()
      await fetchDatasets()
      switchDataset(r.name)
    } catch (e) { console.error(e) }
  }, [fetchDatasets, switchDataset])

  // Delete dataset
  const deleteDataset = useCallback(async (name) => {
    try {
      await fetch(`${API}/datasets/${encodeURIComponent(name)}`, { method:'DELETE' })
      // Remove from hidden if it was muted
      setHiddenSets(prev => {
        const next = new Set(prev)
        next.delete(name)
        localStorage.setItem('sima_hidden', JSON.stringify([...next]))
        return next
      })
      await fetchDatasets()
      if (active === name) {
        setActive(null)
        setAnalysis(null)
        setError(null)
      }
    } catch (e) { console.error(e) }
  }, [active, fetchDatasets])

  // Toggle hide
  const toggleHide = (name) => {
    setHiddenSets(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      localStorage.setItem('sima_hidden', JSON.stringify([...next]))
      return next
    })
    if (active === name) { setActive(null); setAnalysis(null); setError(null) }
  }

  // Correlation method
  useEffect(() => {
    if (!active || tab !== 'correlations') return
    ;(async () => {
      try {
        setCorrelations(await (await fetch(
          `${API}/correlations/${encodeURIComponent(active)}?method=${corrMethod}`
        )).json())
      } catch (e) { console.error(e) }
    })()
  }, [corrMethod, active, tab])

  // Pairwise
  useEffect(() => {
    if (!selectedPair || !active) return
    ;(async () => {
      try {
        setPairwise(await (await fetch(
          `${API}/pairwise/${encodeURIComponent(active)}?col_a=${encodeURIComponent(selectedPair[0])}&col_b=${encodeURIComponent(selectedPair[1])}`
        )).json())
      } catch (e) { console.error(e) }
    })()
  }, [selectedPair, active])

  // Summary
  const fetchSummary = useCallback(async () => {
    if (!active) return; setSummaryLoading(true)
    try { setSummary(await (await fetch(`${API}/summary/${encodeURIComponent(active)}`)).json()) }
    catch (e) { console.error(e) }
    setSummaryLoading(false)
  }, [active])

  useEffect(() => {
    if (tab === 'summary' && !summary && active) fetchSummary()
  }, [tab, active, summary, fetchSummary])

  // ── Axis helpers ──
  const toggleX = (col) => setXCol(prev => prev === col ? '' : col)
  const toggleY = (col) => setYCols(prev => prev.includes(col) ? prev.filter(c=>c!==col) : [...prev, col])
  const toggleZ = (col) => setZCol(prev => prev === col ? '' : col)

  const applySuggestion = (sg) => {
    setChartType(sg.type); setXCol(sg.x||''); setYCols(sg.y||[]); setZCol(sg.z||'')
    setXLabel(''); setYLabel(''); setZLabel('')
    setTab('explorer')
  }

  // ── Styles ──
  const S = {
    app: { minHeight:'100vh', display:'flex', flexDirection:'column', background:'#08080f',
           fontFamily:"'DM Sans','Inter',system-ui,sans-serif", color:'#e8e8ed' },
    header: { padding:'12px 24px', display:'flex', alignItems:'center', justifyContent:'space-between',
              borderBottom:'1px solid rgba(141,153,174,0.08)', background:'rgba(8,8,15,0.95)',
              backdropFilter:'blur(20px)', position:'sticky', top:0, zIndex:100 },
    body: { display:'flex', flex:1, overflow:'hidden' },
    side: { width:260, minWidth:260, borderRight:'1px solid rgba(141,153,174,0.08)',
            padding:'14px 12px', overflowY:'auto', display:'flex', flexDirection:'column', gap:14 },
    main: { flex:1, overflow:'auto', padding:'20px 24px' },
    lbl: { fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'1.5px',
           color:'#555b6e', marginBottom:5 },
    mono: { fontFamily:"'JetBrains Mono',monospace" },
    card: { background:'rgba(141,153,174,0.03)', borderRadius:12,
            border:'1px solid rgba(141,153,174,0.08)', padding:20, marginBottom:16 },
    chip: (on) => ({ padding:'3px 9px', borderRadius:16, border:'1px solid',
      borderColor: on ? 'rgba(233,69,96,0.4)' : 'rgba(141,153,174,0.12)',
      background: on ? 'rgba(233,69,96,0.1)' : 'transparent',
      color: on ? '#e94560' : '#8d99ae', cursor:'pointer', fontSize:11,
      fontFamily:'inherit', transition:'all 0.15s', whiteSpace:'nowrap', lineHeight:'20px' }),
    tab: (on) => ({ padding:'7px 14px', borderRadius:6, border:'none',
      background: on ? 'rgba(233,69,96,0.12)' : 'transparent',
      color: on ? '#e94560' : '#8d99ae', cursor:'pointer', fontSize:12,
      fontFamily:"'DM Sans',sans-serif", fontWeight: on ? 600 : 400 }),
    stat: { background:'rgba(141,153,174,0.04)', borderRadius:8, padding:'10px 12px',
            border:'1px solid rgba(141,153,174,0.06)' },
    btn: { padding:'5px 10px', borderRadius:5, border:'1px solid rgba(233,69,96,0.3)',
           background:'rgba(233,69,96,0.08)', color:'#e94560', cursor:'pointer',
           fontSize:11, fontFamily:'inherit' },
    iconBtn: { background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
               fontSize:12, lineHeight:1, opacity:0.4 },
  }

  // ── Chart rendering ──
  const renderChart = () => {
    if (!data?.length || !xCol || !yCols.length) return null
    const isNumX = colType[xCol] === 'numeric'
    const angle = data.length > 10 ? -35 : 0
    const xP = { dataKey:xCol, tickLine:false,
      tick:{fill:'#8d99ae',fontSize:10,fontFamily:"'JetBrains Mono'"},
      axisLine:{stroke:'rgba(141,153,174,0.15)'},
      ...(isNumX && (chartType==='scatter'||chartType==='bubble') ? {type:'number'} : {}),
      ...(angle ? {angle, textAnchor:'end'} : {}),
      label: xLabel ? {value:xLabel, position:'bottom', fill:'#8d99ae', fontSize:11, offset:angle?35:10} : undefined,
    }
    const yP = { tick:{fill:'#8d99ae',fontSize:10,fontFamily:"'JetBrains Mono'"},
      axisLine:false, tickLine:false,
      label: yLabel ? {value:yLabel, angle:-90, position:'insideLeft', fill:'#8d99ae', fontSize:11, offset:0} : undefined,
    }
    const grid = { strokeDasharray:'3 3', stroke:'rgba(141,153,174,0.08)', vertical:false }
    const mg = { top:10, right:20, bottom:angle?60:xLabel?40:30, left:yLabel?50:20 }

    // Scatter / Bubble
    if (chartType === 'scatter' || chartType === 'bubble') {
      const hasZ = !!zCol
      return (
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={mg}>
            <CartesianGrid {...grid} />
            <XAxis {...xP} name={xLabel||xCol} />
            <YAxis {...yP} name={yLabel||yCols[0]} />
            {hasZ && <ZAxis dataKey={zCol} name={zLabel||zCol} range={[30,600]} />}
            <Tooltip content={<Tip />} />
            <Legend wrapperStyle={{fontFamily:"'JetBrains Mono'",fontSize:11}} />
            {yCols.map((y,i) => (
              <Scatter key={y} name={hasZ ? `${y} (size: ${zLabel||zCol})` : y}
                data={data} dataKey={y} fill={COLORS[i%COLORS.length]}
                fillOpacity={hasZ?0.45:0.7} stroke={COLORS[i%COLORS.length]}
                strokeOpacity={0.6} {...(!hasZ && {r:5})} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )
    }

    // Line / Area / Bar
    const Comp = chartType==='line' ? LineChart : chartType==='area' ? AreaChart : BarChart
    return (
      <ResponsiveContainer width="100%" height={420}>
        <Comp data={data} margin={mg}>
          <CartesianGrid {...grid} />
          <XAxis {...xP} />
          <YAxis {...yP} />
          <Tooltip content={<Tip />} />
          <Legend wrapperStyle={{fontFamily:"'JetBrains Mono'",fontSize:11}} />
          {yCols.map((y,i) => {
            const c = COLORS[i%COLORS.length]
            if (chartType==='line') return <Line key={y} dataKey={y} name={y} stroke={c} strokeWidth={2.5}
              dot={{r:3}} activeDot={{r:5,stroke:'#08080f',strokeWidth:2}} />
            if (chartType==='area') return <Area key={y} dataKey={y} name={y} stroke={c}
              fill={c} fillOpacity={0.12} strokeWidth={2} />
            return <Bar key={y} dataKey={y} name={y} fill={c} radius={[4,4,0,0]} fillOpacity={0.85} />
          })}
        </Comp>
      </ResponsiveContainer>
    )
  }

  // ── Render ──
  return (
    <div style={S.app}>
      {/* HEADER */}
      <div style={S.header}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="2" y="4" width="24" height="20" rx="3" fill="url(#slate)" stroke="rgba(233,69,96,0.4)" strokeWidth="1"/>
            <rect x="5" y="7" width="18" height="2" rx="1" fill="rgba(255,255,255,0.25)"/>
            <rect x="5" y="11" width="14" height="2" rx="1" fill="rgba(255,255,255,0.2)"/>
            <rect x="5" y="15" width="16" height="2" rx="1" fill="rgba(255,255,255,0.15)"/>
            <rect x="5" y="19" width="10" height="2" rx="1" fill="rgba(255,255,255,0.1)"/>
            <defs><linearGradient id="slate" x1="2" y1="4" x2="26" y2="24" gradientUnits="userSpaceOnUse">
              <stop stopColor="#e94560"/><stop offset="1" stopColor="#6366f1"/>
            </linearGradient></defs>
          </svg>
          <span style={{ fontSize:17, fontWeight:700, letterSpacing:'-0.5px' }}>SeeMa</span>
          <span style={{ fontSize:10, color:'#555b6e' }}>data intelligence</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {active && profile && (
            <span style={{ ...S.mono, fontSize:11, color:'#555b6e' }}>
              {analysis?.dataset_name || active} · {profile.shape.rows} rows · {profile.shape.columns} cols
            </span>
          )}
          <button onClick={()=>fileRef.current?.click()} style={S.btn}>Upload CSV / JSON</button>
          <input ref={fileRef} type="file" accept=".csv,.json,.tsv"
            onChange={e=>{handleUpload(e.target.files?.[0]);e.target.value=''}} style={{display:'none'}} />
        </div>
      </div>

      <div style={S.body}>
        {/* ═══ SIDEBAR ═══ */}
        <div style={S.side}>

          {/* Dataset list with CRUD */}
          <div>
            <div style={S.lbl}>Datasets</div>
            {Object.entries(datasetList).map(([name, info]) => {
              const hidden = hiddenSets.has(name)
              return (
                <div key={name} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:4 }}>
                  <button onClick={() => !hidden && switchDataset(name)} style={{
                    ...S.chip(active === name && !hidden), flex:1, textAlign:'left',
                    borderRadius:6, padding:'7px 9px',
                    opacity: hidden ? 0.35 : 1, textDecoration: hidden ? 'line-through' : 'none',
                  }}>
                    <div style={{ fontSize:12, fontWeight: active===name ? 600 : 400 }}>{name}</div>
                    <div style={{ fontSize:10, color:'#555b6e', marginTop:1 }}>{info.rows} rows · {info.columns} cols</div>
                  </button>
                  <button title={hidden ? 'Show' : 'Mute'} style={S.iconBtn}
                    onClick={() => toggleHide(name)}>{hidden ? '👁' : '🔇'}</button>
                  <button title="Delete" style={{...S.iconBtn, color:'#e94560'}}
                    onClick={() => { if (confirm(`Delete "${name}"?`)) deleteDataset(name) }}>✕</button>
                </div>
              )
            })}
            {Object.keys(datasetList).length === 0 && (
              <div style={{ fontSize:11, color:'#555b6e', fontStyle:'italic' }}>No datasets. Upload one above.</div>
            )}
          </div>

          {/* Only show axis controls when we have analysis for the active dataset */}
          {analysis && (
            <>
              {/* X Axis — toggleable */}
              <div>
                <div style={S.lbl}>X Axis</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {allPlottable.map(c => (
                    <button key={c} style={S.chip(xCol===c)} onClick={() => toggleX(c)}>
                      {c}<Badge type={colType[c]} />
                    </button>
                  ))}
                </div>
                {allPlottable.length === 0 && (
                  <div style={{ fontSize:10, color:'#555b6e', fontStyle:'italic' }}>No plottable columns detected</div>
                )}
              </div>

              {/* Y Axes — multi-toggle */}
              <div>
                <div style={S.lbl}>Y Axes (numeric)</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {numericCols.map(c => (
                    <button key={c} style={S.chip(yCols.includes(c))} onClick={() => toggleY(c)}>{c}</button>
                  ))}
                </div>
                {numericCols.length === 0 && (
                  <div style={{ fontSize:10, color:'#555b6e', fontStyle:'italic' }}>No numeric columns</div>
                )}
              </div>

              {/* Z Axis — for scatter/bubble */}
              {(chartType === 'scatter' || chartType === 'bubble') && numericCols.length > 0 && (
                <div>
                  <div style={S.lbl}>Z Axis (bubble size)</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                    <button style={S.chip(!zCol)} onClick={() => setZCol('')}>none</button>
                    {numericCols.map(c => (
                      <button key={c} style={S.chip(zCol===c)} onClick={() => toggleZ(c)}>{c}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chart type */}
              <div>
                <div style={S.lbl}>Chart Type</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {['bar','line','area','scatter','bubble'].map(t => (
                    <button key={t} style={S.chip(chartType===t)} onClick={() => setChartType(t)}>{t}</button>
                  ))}
                </div>
              </div>

              {/* Custom labels */}
              <div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={S.lbl}>Axis Labels</div>
                  <button style={{...S.iconBtn, fontSize:10, opacity:0.6}}
                    onClick={() => setEditingLabels(!editingLabels)}>
                    {editingLabels ? '▲ close' : '✎ edit'}
                  </button>
                </div>
                {editingLabels && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:4 }}>
                    {[['X label', xLabel, setXLabel], ['Y label', yLabel, setYLabel],
                      ...((chartType==='scatter'||chartType==='bubble') ? [['Z label', zLabel, setZLabel]] : [])
                    ].map(([placeholder, val, setter]) => (
                      <input key={placeholder} placeholder={placeholder} value={val}
                        onChange={e => setter(e.target.value)} style={{
                          background:'rgba(141,153,174,0.06)', border:'1px solid rgba(141,153,174,0.12)',
                          borderRadius:5, padding:'5px 8px', color:'#e8e8ed', fontSize:11,
                          fontFamily:'inherit', outline:'none',
                        }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div>
                  <div style={S.lbl}>Suggested Views</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    {suggestions.slice(0,6).map((sg,i) => (
                      <button key={i} onClick={() => applySuggestion(sg)} style={{
                        padding:'7px 9px', borderRadius:6, textAlign:'left', cursor:'pointer',
                        background:'rgba(141,153,174,0.04)', border:'1px solid rgba(141,153,174,0.08)',
                        color:'#8d99ae', fontFamily:'inherit', fontSize:11,
                      }}>
                        <div style={{ color:'#e8e8ed', fontWeight:500, marginBottom:1 }}>{sg.title}</div>
                        <div style={{ fontSize:10, color:'#555b6e' }}>{sg.reason}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ═══ MAIN ═══ */}
        <div style={S.main}>
          {loading && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'40vh' }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:32, opacity:0.2, marginBottom:8 }}>◇</div>
                <div style={{ color:'#555b6e', fontSize:12 }}>Analyzing dataset...</div>
              </div>
            </div>
          )}

          {!loading && !error && analysis && (
            <>
              {/* TABS */}
              <div style={{ display:'flex', gap:4, marginBottom:20 }}>
                {['explorer','correlations','summary'].map(t => (
                  <button key={t} style={S.tab(tab===t)} onClick={() => setTab(t)}>
                    {t === 'summary' ? 'AI Summary' : t.charAt(0).toUpperCase()+t.slice(1)}
                  </button>
                ))}
              </div>

              {/* ══ EXPLORER ══ */}
              {tab === 'explorer' && (
                <div>
                  {/* Chart or helper message */}
                  {xCol && yCols.length > 0 ? (
                    <div style={S.card}>
                      <div style={{ ...S.lbl, marginBottom:12 }}>
                        {chartType.toUpperCase()} · {xLabel||xCol} vs {yCols.map(y=>yLabel||y).join(', ')}
                        {zCol ? ` · size: ${zLabel||zCol}` : ''}
                      </div>
                      {renderChart()}
                    </div>
                  ) : (
                    <div style={{ ...S.card, textAlign:'center', padding:'30px 20px', color:'#555b6e' }}>
                      <div style={{ fontSize:13, marginBottom:6 }}>
                        {!xCol && !yCols.length
                          ? 'Select an X axis and Y axis from the sidebar to visualize'
                          : !xCol ? 'Select an X axis from the sidebar'
                          : 'Select at least one Y axis (numeric) from the sidebar'}
                      </div>
                      <div style={{ fontSize:11 }}>
                        Click a column chip to select it. Click again to deselect.
                      </div>
                      {suggestions.length > 0 && (
                        <button onClick={() => applySuggestion(suggestions[0])} style={{
                          ...S.btn, marginTop:12, padding:'8px 16px',
                        }}>
                          Auto-configure: {suggestions[0].title}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Column profiles */}
                  {profile?.columns?.some(c => c.type === 'numeric') && (
                    <div style={S.card}>
                      <div style={{ ...S.lbl, marginBottom:10 }}>Column Profiles</div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))', gap:10 }}>
                        {profile.columns.filter(c => c.type==='numeric').map(col => (
                          <div key={col.name} style={S.stat}>
                            <div style={{ fontSize:11, color:'#e8e8ed', fontWeight:500, marginBottom:5 }}>
                              {col.name}<Badge type="numeric" />
                            </div>
                            <div style={{ ...S.mono, fontSize:10, color:'#8d99ae', lineHeight:1.8 }}>
                              <div>μ {col.stats.mean?.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                              <div>σ {col.stats.std?.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                              <div>[{col.stats.min}, {col.stats.max}]</div>
                              {col.distribution?.type && <div style={{color:'#555b6e'}}>{col.distribution.type}</div>}
                              {col.outliers?.count > 0 && <div style={{color:'#f59e0b'}}>{col.outliers.count} outliers</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Categorical profiles */}
                  {(cols.categorical.length > 0 || cols.high_cardinality.length > 0) && (
                    <div style={S.card}>
                      <div style={{ ...S.lbl, marginBottom:10 }}>Categorical Columns</div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))', gap:10 }}>
                        {profile?.columns?.filter(c => c.type==='categorical').map(col => (
                          <div key={col.name} style={S.stat}>
                            <div style={{ fontSize:11, color:'#e8e8ed', fontWeight:500, marginBottom:5 }}>
                              {col.name}<Badge type={colType[col.name]} />
                            </div>
                            <div style={{ ...S.mono, fontSize:10, color:'#8d99ae', lineHeight:1.8 }}>
                              <div>{col.unique} unique values</div>
                              {col.top_values && <div style={{color:'#555b6e'}}>
                                Top: {col.top_values.slice(0,3).map(v=>`${v[0]}(${v[1]})`).join(', ')}
                              </div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Data preview */}
                  <div style={S.card}>
                    <div style={{ ...S.lbl, marginBottom:10 }}>
                      Data Preview <span style={{ fontWeight:400, letterSpacing:0, textTransform:'none', marginLeft:6 }}>
                        showing {Math.min(12, data.length)} of {totalRows}
                      </span>
                    </div>
                    <div style={{ overflowX:'auto' }}>
                      <table style={{ width:'100%', borderCollapse:'collapse', ...S.mono, fontSize:11 }}>
                        <thead>
                          <tr>{allProfileCols.map(c => (
                            <th key={c} style={{ padding:'5px 8px', textAlign:'left', color:'#555b6e',
                              fontWeight:600, fontSize:10, borderBottom:'1px solid rgba(141,153,174,0.08)',
                              background:'rgba(141,153,174,0.03)', whiteSpace:'nowrap' }}>
                              {c}<Badge type={colType[c]} />
                            </th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {data.slice(0,12).map((row,i) => (
                            <tr key={i}>{allProfileCols.map(c => (
                              <td key={c} style={{ padding:'4px 8px', whiteSpace:'nowrap',
                                color: colType[c]==='numeric' ? '#e8e8ed' : '#8d99ae',
                                borderBottom:'1px solid rgba(141,153,174,0.04)',
                                maxWidth:180, overflow:'hidden', textOverflow:'ellipsis' }}>
                                {row[c]==null ? '' : typeof row[c]==='number'
                                  ? row[c].toLocaleString(undefined,{maximumFractionDigits:4}) : String(row[c])}
                              </td>
                            ))}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ══ CORRELATIONS ══ */}
              {tab === 'correlations' && (
                <div>
                  {correlations && !correlations.error ? (
                    <>
                      <div style={{ display:'flex', gap:6, marginBottom:16, alignItems:'center' }}>
                        <span style={{ ...S.lbl, marginBottom:0 }}>Method</span>
                        {['pearson','spearman','kendall'].map(m => (
                          <button key={m} style={S.chip(corrMethod===m)} onClick={() => setCorrMethod(m)}>{m}</button>
                        ))}
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns: selectedPair ? '1fr 1fr' : '1fr', gap:16 }}>
                        <div style={S.card}>
                          <div style={{ ...S.lbl, marginBottom:12 }}>Correlation Matrix</div>
                          <div style={{ overflowX:'auto' }}>
                            <table style={{ borderCollapse:'collapse', ...S.mono, fontSize:11 }}>
                              <thead><tr>
                                <th style={{padding:6}} />
                                {correlations.columns.map(c => (
                                  <th key={c} style={{ padding:'6px 8px', color:'#8d99ae', fontWeight:500,
                                    fontSize:10, transform:'rotate(-45deg)', whiteSpace:'nowrap', height:60 }}>{c}</th>
                                ))}
                              </tr></thead>
                              <tbody>{correlations.columns.map((row,i) => (
                                <tr key={row}>
                                  <td style={{ padding:'6px 8px', color:'#8d99ae', fontWeight:500, fontSize:10, whiteSpace:'nowrap' }}>{row}</td>
                                  {correlations.columns.map((col,j) => {
                                    const v = correlations.matrix[i][j]
                                    const sel = selectedPair && ((selectedPair[0]===row&&selectedPair[1]===col)||(selectedPair[0]===col&&selectedPair[1]===row))
                                    return <td key={col} onClick={() => i!==j && setSelectedPair([row,col])} style={{
                                      padding:'6px 8px', background:corrColor(i===j?null:v),
                                      cursor:i===j?'default':'pointer', textAlign:'center',
                                      color:Math.abs(v)>0.5?'#fff':'#8d99ae', fontWeight:Math.abs(v)>0.7?600:400,
                                      fontSize:10, border:sel?'2px solid #e94560':'1px solid rgba(141,153,174,0.05)',
                                      borderRadius:3, minWidth:46,
                                    }}>{i===j ? '1' : v?.toFixed(2)}</td>
                                  })}
                                </tr>
                              ))}</tbody>
                            </table>
                          </div>
                        </div>

                        {selectedPair && pairwise && (
                          <div style={S.card}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                              <div style={S.lbl}>{selectedPair[0]} vs {selectedPair[1]}</div>
                              <button onClick={() => {setSelectedPair(null);setPairwise(null)}}
                                style={{ background:'none', border:'none', color:'#555b6e', cursor:'pointer', fontSize:14 }}>✕</button>
                            </div>
                            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(95px,1fr))', gap:8, marginBottom:14 }}>
                              {pairwise.pearson && <div style={S.stat}>
                                <div style={{fontSize:10,color:'#555b6e'}}>Pearson r</div>
                                <div style={{...S.mono,fontSize:16,fontWeight:600}}>{pairwise.pearson.r}</div>
                                <div style={{fontSize:9,color:pairwise.pearson.p<0.05?'#10b981':'#f59e0b'}}>
                                  p={pairwise.pearson.p<0.001?'<0.001':pairwise.pearson.p}</div>
                              </div>}
                              {pairwise.spearman && <div style={S.stat}>
                                <div style={{fontSize:10,color:'#555b6e'}}>Spearman ρ</div>
                                <div style={{...S.mono,fontSize:16,fontWeight:600}}>{pairwise.spearman.r}</div>
                              </div>}
                              {pairwise.regression && <>
                                <div style={S.stat}>
                                  <div style={{fontSize:10,color:'#555b6e'}}>R²</div>
                                  <div style={{...S.mono,fontSize:16,fontWeight:600}}>{pairwise.regression.r_squared}</div>
                                </div>
                                <div style={S.stat}>
                                  <div style={{fontSize:10,color:'#555b6e'}}>Slope</div>
                                  <div style={{...S.mono,fontSize:14,fontWeight:600}}>{pairwise.regression.slope.toFixed(4)}</div>
                                </div>
                              </>}
                            </div>
                            {pairwise.scatter && (
                              <ResponsiveContainer width="100%" height={240}>
                                <ScatterChart margin={{top:10,right:20,bottom:30,left:20}}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(141,153,174,0.08)" />
                                  <XAxis dataKey="x" name={selectedPair[0]} type="number"
                                    tick={{fill:'#8d99ae',fontSize:10}} axisLine={{stroke:'rgba(141,153,174,0.15)'}} tickLine={false}
                                    label={{value:selectedPair[0],position:'bottom',fill:'#555b6e',fontSize:10,offset:15}} />
                                  <YAxis dataKey="y" name={selectedPair[1]} type="number"
                                    tick={{fill:'#8d99ae',fontSize:10}} axisLine={false} tickLine={false}
                                    label={{value:selectedPair[1],angle:-90,position:'insideLeft',fill:'#555b6e',fontSize:10}} />
                                  <Tooltip content={<Tip />} />
                                  <Scatter data={pairwise.scatter} fill="#e94560" fillOpacity={0.6} r={5} />
                                </ScatterChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        )}
                      </div>

                      {correlations.notable_correlations?.length > 0 && (
                        <div style={S.card}>
                          <div style={{...S.lbl,marginBottom:10}}>Notable Correlations</div>
                          {correlations.notable_correlations.slice(0,10).map((c,i) => (
                            <div key={i} onClick={() => setSelectedPair([c.col_a,c.col_b])} style={{
                              display:'flex', alignItems:'center', gap:12, padding:'7px 12px', marginBottom:4,
                              borderRadius:8, background:'rgba(141,153,174,0.04)', cursor:'pointer',
                              border:'1px solid rgba(141,153,174,0.06)' }}>
                              <span style={{...S.mono,fontSize:14,fontWeight:700,minWidth:55,
                                color:c.direction==='positive'?'#e94560':'#6366f1'}}>
                                {c.correlation>0?'+':''}{c.correlation.toFixed(2)}</span>
                              <span style={{fontSize:12}}>{c.col_a} ↔ {c.col_b}</span>
                              <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10,
                                background:c.strength==='strong'?'rgba(233,69,96,0.12)':
                                  c.strength==='moderate'?'rgba(245,158,11,0.12)':'rgba(141,153,174,0.08)',
                                color:c.strength==='strong'?'#e94560':c.strength==='moderate'?'#f59e0b':'#8d99ae' }}>
                                {c.strength}</span>
                              {c.significant && <span style={{fontSize:9,color:'#10b981'}}>significant</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{...S.card, color:'#555b6e', textAlign:'center', padding:40}}>
                      {correlations?.error || 'Need at least 2 numeric columns for correlation analysis'}
                    </div>
                  )}
                </div>
              )}

              {/* ══ SUMMARY ══ */}
              {tab === 'summary' && (
                <div>
                  <div style={S.card}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                      <div style={S.lbl}>SeeMa Intelligence Report</div>
                      <button onClick={fetchSummary} style={{...S.btn, padding:'6px 14px'}}>
                        {summaryLoading ? '◇ Analyzing...' : '↻ Regenerate'}</button>
                    </div>
                    {summaryLoading ? (
                      <div style={{ padding:60, textAlign:'center' }}>
                        <div style={{ fontSize:28, opacity:0.3, marginBottom:14, animation:'spin 2s linear infinite' }}>◇</div>
                        <div style={{ color:'#8d99ae', fontSize:13 }}>SeeMa is analyzing your data...</div>
                        <div style={{ color:'#555b6e', fontSize:11, marginTop:6 }}>Building domain context, computing distributions, identifying patterns...</div>
                      </div>
                    ) : summary ? (
                      <>
                        <div style={{ fontSize:14, lineHeight:1.9, color:'#e8e8ed', padding:'20px 24px',
                          background:'rgba(141,153,174,0.03)', borderRadius:10, borderLeft:'3px solid #e94560' }}>
                          {summary.summary.split('\n').map((line, i) => {
                            // Render **bold** as styled spans
                            if (!line.trim()) return <div key={i} style={{ height: 12 }} />
                            const parts = line.split(/\*\*(.*?)\*\*/g)
                            return (
                              <p key={i} style={{ margin:'0 0 8px 0' }}>
                                {parts.map((part, j) =>
                                  j % 2 === 1
                                    ? <span key={j} style={{ color:'#e94560', fontWeight:700, fontSize:15 }}>{part}</span>
                                    : <span key={j}>{part}</span>
                                )}
                              </p>
                            )
                          })}
                        </div>
                        <div style={{ marginTop:10, fontSize:10, color:'#555b6e', display:'flex', alignItems:'center', gap:8 }}>
                          <span>Source: {summary.source==='ai' ? 'Claude AI' : 'Statistical engine'}</span>
                          {summary.source !== 'ai' && (
                            <span style={{ color:'#f59e0b' }}>Set ANTHROPIC_API_KEY for full AI analysis</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div style={{ padding:40, textAlign:'center' }}>
                        <div style={{ fontSize:13, color:'#8d99ae', marginBottom:8 }}>
                          Click Regenerate to run a full AI-powered analysis of this dataset.
                        </div>
                        <div style={{ fontSize:11, color:'#555b6e' }}>
                          SeeMa will infer the domain, interpret metrics in context, flag data quality issues, and suggest next steps.
                        </div>
                      </div>
                    )}
                  </div>
                  {summary?.raw_stats && (
                    <details style={{ marginBottom:16 }}>
                      <summary style={{ cursor:'pointer', fontSize:11, color:'#555b6e', padding:'8px 0' }}>
                        ▸ Raw statistical profile
                      </summary>
                      <div style={S.card}>
                        <pre style={{ ...S.mono, fontSize:10, color:'#8d99ae', lineHeight:1.6,
                          whiteSpace:'pre-wrap', wordBreak:'break-word', background:'rgba(141,153,174,0.04)',
                          padding:16, borderRadius:8 }}>{summary.raw_stats}</pre>
                      </div>
                    </details>
                  )}
                </div>
              )}
            </>
          )}

          {/* Error state */}
          {!loading && error && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'50vh' }}>
              <div style={{ textAlign:'center', maxWidth:500 }}>
                <div style={{ fontSize:36, marginBottom:16 }}>⚠</div>
                <div style={{ fontSize:13, color:'#e94560', marginBottom:12, lineHeight:1.6 }}>{error}</div>
                <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                  <button onClick={() => active && loadAnalysis(active)} style={S.btn}>Retry</button>
                  <button onClick={() => { setActive(null); setError(null) }}
                    style={{...S.btn, borderColor:'rgba(141,153,174,0.2)', color:'#8d99ae', background:'rgba(141,153,174,0.06)'}}>
                    Deselect</button>
                </div>
              </div>
            </div>
          )}

          {/* Empty state: no dataset selected */}
          {!loading && !error && !analysis && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:48, opacity:0.15, marginBottom:16 }}>◇</div>
                <div style={{ fontSize:14, color:'#555b6e' }}>Upload a dataset or select one to begin</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}