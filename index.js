.search-result-pill{
  display:grid;
  gap:4px;
  text-align:left;
  line-height:1.2;
}

.search-result-main{
  display:block;
  font-weight:700;
}

.search-result-sub{
  display:block;
  font-size:11px;
  opacity:.72;
}

.search-result-pill--arc{
  background:#eef3ff;
}

.search-result-pill--annotation{
  background:#f6f6f6;
}

.search-result-pill--tag_cluster,
.search-result-pill--chapter{
  background:#fff8ed;
}

.retention-toast{
  position:fixed;
  left:50%;
  bottom:20px;
  transform:translateX(-50%) translateY(10px);
  background:rgba(10,12,18,.96);
  color:#fff;
  border:1px solid rgba(255,255,255,.12);
  border-radius:999px;
  padding:10px 16px;
  box-shadow:0 18px 40px rgba(0,0,0,.35);
  opacity:0;
  pointer-events:none;
  transition:opacity .18s ease, transform .18s ease;
  z-index:999999;
}

.retention-toast.show{
  opacity:1;
  transform:translateX(-50%) translateY(0);
}

.page-annotation-badge{
  position:absolute;
  left:12px;
  top:12px;
  background:rgba(0,0,0,.72);
  color:#fff;
  border:1px solid rgba(255,255,255,.14);
  border-radius:999px;
  padding:6px 10px;
  font-size:12px;
  line-height:1;
  z-index:2;
}
