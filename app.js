(() => {
  'use strict';
  const STORAGE_KEY = 'techno-campgain-pwa-v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const faDigits = value => String(value ?? '').replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  const parseNumber = value => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const normalized = String(value).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٬,\s]/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const money = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? 'تعیین نشده' : `${faDigits(Math.round(Number(value)).toLocaleString('en-US').replace(/,/g, '٬'))} تومان`;
  const integer = value => value === null || value === undefined ? 'ثبت نشده' : faDigits(Math.round(Number(value)).toLocaleString('en-US').replace(/,/g, '٬'));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  const defaultTiers = () => [
    {id:uid('tier'),name:'برنزی',endQty:null,reward:null},
    {id:uid('tier'),name:'نقره‌ای',endQty:null,reward:null},
    {id:uid('tier'),name:'طلایی',endQty:null,reward:null},
    {id:uid('tier'),name:'پلاتینیوم',endQty:null,reward:null}
  ];
  const initialState = () => ({campaigns:[],representatives:[],lastUpdated:Date.now()});
  let state = loadState();
  let appRole = null;
  let currentPage = 'home';
  let currentRepId = null;
  let selectedCampaignId = null;
  let editingCampaignId = null;
  let toastTimer = null;

  function loadState(){
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.campaigns) || !Array.isArray(parsed.representatives)) return initialState();
      parsed.campaigns = parsed.campaigns.map(c => ({...c, tiers:Array.isArray(c.tiers)&&c.tiers.length?c.tiers:defaultTiers()}));
      parsed.representatives = parsed.representatives.map(r => ({...r,salesByCampaign:r.salesByCampaign||{}}));
      return parsed;
    } catch { return initialState(); }
  }
  function persist(){
    state.lastUpdated = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch { toast('ذخیره اطلاعات در این مرورگر ممکن نشد. فضای ذخیره‌سازی را بررسی کنید.','error'); return false; }
  }
  function toast(message, type='success'){
    const region = $('#toastRegion'); if (!region) return;
    const node = document.createElement('div'); node.className = `toast ${type}`;
    node.innerHTML = `<span>${esc(message)}</span><button class="modal-close" aria-label="بستن پیام">×</button>`;
    region.appendChild(node);
    $('button',node).addEventListener('click',()=>node.remove());
    setTimeout(()=>node.remove(),4200);
  }
  function campaignById(id){ return state.campaigns.find(c=>c.id===id) || null; }
  function repById(id){ return state.representatives.find(r=>r.id===id) || null; }
  function dateText(){
    try { return new Intl.DateTimeFormat('fa-IR',{weekday:'short',day:'numeric',month:'long'}).format(new Date()); }
    catch { return ''; }
  }
  function statusText(status){return ({draft:'پیش‌نویس',active:'فعال',paused:'متوقف',ended:'پایان‌یافته'})[status]||'پیش‌نویس';}
  function statusClass(status){return `status-${status||'draft'}`;}
  function tierClass(index){return ['bronze','silver','gold','platinum'][index] || 'platinum';}
  function tierIcon(index){return ['◆','◇','✦','✧'][index] || '✧';}
  function tierStart(tiers,index){return index===0?1:((Number(tiers[index-1]?.endQty)||0)+1);}
  function tierFiniteEnd(tier,index,tiers){return index < tiers.length-1 ? parseNumber(tier.endQty) : null;}
  function campaignConfigured(campaign){
    if (!campaign || !campaign.name?.trim() || parseNumber(campaign.budget)===null || parseNumber(campaign.budget)<=0 || !Array.isArray(campaign.tiers) || campaign.tiers.length===0) return false;
    let previous=0;
    for(let i=0;i<campaign.tiers.length;i++){
      const t=campaign.tiers[i];
      if(!t.name?.trim() || parseNumber(t.reward)===null || parseNumber(t.reward)<=0) return false;
      if(i<campaign.tiers.length-1){
        const end=parseNumber(t.endQty);
        if(end===null || end<=previous) return false;
        previous=end;
      }
    }
    return true;
  }
  function sortedCampaigns(){return [...state.campaigns].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));}
  function activeCampaigns(){return state.campaigns.filter(c=>c.status==='active');}
  function campaignSales(rep,campaignId){
    if(!rep || !campaignId) return null;
    const value=rep.salesByCampaign?.[campaignId];
    return value===null || value===undefined || value==='' ? null : Math.max(0,Number(value)||0);
  }
  function normalizeSaleCount(value){const n=parseNumber(value);return n===null?null:Math.floor(n);}
  function tierIndexForSales(campaign,sales){
    if(!campaign?.tiers?.length || sales===null || sales===undefined) return -1;
    const tiers=campaign.tiers;
    for(let i=0;i<tiers.length-1;i++){
      const end=parseNumber(tiers[i].endQty);
      if(end===null) return -1;
      if(sales<=end) return i;
    }
    return tiers.length-1;
  }
  function activeProgressTierIndex(campaign,sales){
    if(!campaign?.tiers?.length || sales===null || sales===undefined) return -1;
    for(let i=0;i<campaign.tiers.length-1;i++){
      const end=parseNumber(campaign.tiers[i].endQty);
      if(end!==null && sales<end) return i;
      // At an exact boundary the next tier becomes the next reward milestone.
      if(end!==null && sales===end) continue;
      if(end===null) return -1;
    }
    return campaign.tiers.length-1;
  }
  function payoutPerTier(tiers,index){
    const start=tierStart(tiers,index); const end=tierFiniteEnd(tiers[index],index,tiers);
    const reward=parseNumber(tiers[index].reward);
    if(reward===null) return null;
    if(end===null) return null;
    if(end<start) return 0;
    return (end-start+1)*reward;
  }
  function totalEarnedPayout(campaign,sales){
    if(!campaign?.tiers?.length || sales===null || sales===undefined) return null;
    let total=0; const tiers=campaign.tiers;
    for(let i=0;i<tiers.length-1;i++){
      const end=parseNumber(tiers[i].endQty), reward=parseNumber(tiers[i].reward);
      if(end===null || reward===null) return null;
      if(sales>=end){const start=tierStart(tiers,i);total+=Math.max(0,end-start+1)*reward;}
      else break;
    }
    const last=tiers.length-1; const lastReward=parseNumber(tiers[last].reward); const previousEnd=last===0?0:parseNumber(tiers[last-1].endQty);
    if(lastReward===null || (last>0 && previousEnd===null)) return null;
    const firstLast=last===0?1:previousEnd+1;
    const soldInLast=Math.max(0,sales-firstLast+1);
    total+=soldInLast*lastReward;
    return total;
  }
  function progressInfo(campaign,sales){
    if(!campaign || !Array.isArray(campaign.tiers)||!campaign.tiers.length) return null;
    if(sales===null || sales===undefined) return {unknown:true, message:'میزان فروش این کارگزار هنوز توسط مدیریت ثبت نشده است.'};
    const tiers=campaign.tiers;
    const achievedIndex=sales<1?-1:tierIndexForSales(campaign,sales);
    const targetIndex=activeProgressTierIndex(campaign,sales);
    if(targetIndex<0) return {unknown:true,message:'پلکان‌های کمپین هنوز به‌طور کامل تنظیم نشده‌اند.'};
    const achieved=achievedIndex>=0?tiers[achievedIndex]:null;
    const target=tiers[targetIndex];
    const targetEnd=tierFiniteEnd(target,targetIndex,tiers);
    const targetStart=tierStart(tiers,targetIndex);
    const remaining=targetEnd===null?Math.max(0,targetStart-sales):Math.max(0,targetEnd-sales);
    const unitsToEnterNext=targetEnd===null?Math.max(0,targetStart-sales):Math.max(0,targetEnd-sales+1);
    const nextTier=targetIndex<tiers.length-1?tiers[targetIndex+1]:null;
    const blockReward=payoutPerTier(tiers,targetIndex);
    const earned=totalEarnedPayout(campaign,sales);
    const previousEnd=targetIndex===0?0:parseNumber(tiers[targetIndex-1].endQty);
    const alreadyInTarget=Math.max(0,sales-Math.max(0,previousEnd||0));
    const progressPct=targetEnd===null?(sales>=targetStart?100:0):Math.max(0,Math.min(100,((sales-targetStart+1)/(targetEnd-targetStart+1))*100));
    const messages=[];
    if(targetEnd===null){
      const unitReward=parseNumber(target.reward);
      if(sales<targetStart){
        const toEnter=targetStart-sales;
        messages.push(`فقط ${faDigits(toEnter)} فروش معتبر دیگر تا ورود به سطح ${target.name} باقی مانده است. پس از ورود، هر دستگاه با نرخ ${unitReward===null?'پاداش تعیین‌نشده':money(unitReward)} محاسبه می‌شود.`);
        messages.push(`سطح فعلی شما ${achieved?.name||'هنوز سطحی کسب نکرده‌اید'} است؛ با ${faDigits(toEnter)} فروش دیگر به سطح ${target.name} می‌رسید.`);
      } else {
        messages.push(`شما در سطح ${target.name} قرار دارید. هر دستگاه معتبر جدید، ${unitReward===null?'مبلغ پاداش تنظیم‌نشده':money(unitReward)} پاداش برای شما ایجاد می‌کند.`);
        messages.push(`فروش معتبر ثبت‌شده شما ${faDigits(sales.toLocaleString('en-US'))} دستگاه است. شما در بالاترین سطح کمپین قرار دارید.`);
      }
    } else {
      if(remaining>0){
        messages.push(`فقط ${faDigits(remaining)} فروش معتبر دیگر تا تکمیل بازه ${target.name} و دریافت پاداش این سطح${blockReward===null?'':` به مبلغ ${money(blockReward)}`} باقی مانده است.`);
      } else {
        messages.push(`بازه ${target.name} تکمیل شده است. برای ورود به سطح بعدی ${nextTier?`یعنی ${nextTier.name}`:'سطح بالاتر'}، مسیر فروش را ادامه دهید.`);
      }
      if(nextTier){
        messages.push(`برای رسیدن به سطح ${nextTier.name}، ${faDigits(unitsToEnterNext)} دستگاه دیگر از فروش فعلی فاصله دارید. با تکمیل این بازه، پاداش ${blockReward===null?'این سطح':money(blockReward)} برای شما قابل دریافت می‌شود.`);
      } else {
        messages.push(`با تکمیل فروش ${faDigits(targetEnd)} دستگاه، به بالاترین سطح کمپین، یعنی ${target.name} می‌رسید.`);
      }
    }
    return {unknown:false,sales,achievedIndex,achieved,targetIndex,target,targetEnd,targetStart,nextTier,remaining,unitsToEnterNext,blockReward,earned,progressPct,alreadyInTarget,messages};
  }
  function lineMessages(campaign,sales){const info=progressInfo(campaign,sales);return info?info.messages:['برای نمایش خط جاری فروش، ابتدا کمپین و میزان فروش کارگزار را ثبت کنید.'];}
  function tickerHTML(messages){
    const text=messages.map((m,i)=>`<span class="ticker-message"><strong>${i===0?'وضعیت فروش':'مسیر ارتقا'}</strong>${esc(m)}</span><span class="ticker-separator">✦</span>`).join('');
    return `<section class="rep-ticker" aria-label="خط جاری فروش"><div class="ticker-head"><i class="live-dot"></i><b>خط جاری فروش</b><small>به‌روزرسانی بر اساس فروش معتبر</small></div><div class="ticker-window"><div class="ticker-track">${text}${text}</div></div></section>`;
  }
  function levelBadgeHTML(index,name){return `<span class="level-badge ${index<0?'level-unknown':`level-${tierClass(index)}`}" >${esc(name||'تنظیم نشده')}</span>`;}
  function campaignOptionList(selectedId, onlyActive=false){
    const cs=onlyActive?activeCampaigns():sortedCampaigns();
    return `<option value="">${cs.length?'انتخاب کمپین':'کمپینی ثبت نشده است'}</option>`+cs.map(c=>`<option value="${esc(c.id)}" ${c.id===selectedId?'selected':''}>${esc(c.name||'کمپین بدون نام')} · ${esc(statusText(c.status))}</option>`).join('');
  }
  function repsForCampaign(campaignId){return state.representatives.map(r=>({rep:r,sales:campaignSales(r,campaignId)}));}
  function statusLabelHTML(status){return `<span class="status-pill ${statusClass(status)}">${statusText(status)}</span>`;}
  function maybeUpdateServiceWorker(){
    if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  function enterRole(role){
    appRole=role; currentPage=role==='manager'?'home':'agent';
    $('#roleGate').classList.add('hidden');$('#appShell').classList.remove('hidden');
    if(role==='broker' && state.representatives.length && !repById(currentRepId)) currentRepId=state.representatives[0].id;
    if(role==='manager') renderManagerPage('home'); else renderBrokerPage();
  }
  function goRoleGate(){appRole=null;$('#appShell').classList.add('hidden');$('#roleGate').classList.remove('hidden');}
  function setCurrentRep(id){currentRepId=id||null;if(appRole==='broker')renderBrokerPage();}
  function renderSidebar(){
    const isManager=appRole==='manager';
    const nav=isManager?[
      ['home','▦','نمای کلی'],['campaigns','◈','کمپین‌ها'],['editor','＋','طراحی کمپین'],['representatives','♙','کارگزاران'],['reports','▤','گزارش‌ها']
    ]:[['agent','▦','داشبورد من'],['agent-rules','◈','سطوح و پاداش']];
    $('#sidebar').innerHTML=`<div class="brand-lockup"><img src="assets/tosan-techno-logo.png" alt="لوگوی توسن تکنو"><span class="brand-name"><b>Techno Campgain</b><small>سامانه کمپین‌های فروش</small></span></div><div class="side-label">${isManager?'مرکز کنترل مدیریت':'فضای کارگزار'}</div><nav class="nav-list">${nav.map(([id,icon,label])=>`<button class="nav-button ${currentPage===id?'active':''}" data-page-nav="${id}"><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>${id==='campaigns'&&isManager?`<span class="nav-badge">${faDigits(state.campaigns.length)}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><i class="online-dot"></i><span><b>حالت نمونه‌سازی</b><small>ذخیره اطلاعات در مرورگر</small></span></div>`;
  }
  function renderTopbar(){
    const isManager=appRole==='manager';
    const labels={home:'نمای کلی',campaigns:'کمپین‌ها',editor:editingCampaignId?'ویرایش کمپین':'طراحی کمپین',representatives:'مدیریت کارگزاران',reports:'گزارش‌های مدیریتی',agent:'داشبورد کارگزار', 'agent-rules':'سطوح و پاداش'};
    let repControl='';
    if(!isManager && state.representatives.length){
      repControl=`<select id="topRepSelect" class="select-control rep-select" aria-label="انتخاب کارگزار">${state.representatives.map(r=>`<option value="${esc(r.id)}" ${r.id===currentRepId?'selected':''}>${esc(r.name)}</option>`).join('')}</select>`;
    }
    $('#topbar').innerHTML=`<div class="crumbs"><span>Techno Campgain</span><i class="crumb-dot"></i><strong>${labels[currentPage]||'سامانه کمپین‌ها'}</strong></div><div class="top-actions">${repControl}<span class="role-chip">${isManager?'دسترسی مدیریت':'دسترسی کارگزار'}</span><span class="top-user">${isManager?'م':'ک'}</span><button class="text-action" id="changeAccess">تغییر دسترسی</button></div>`;
    $('#changeAccess').addEventListener('click',goRoleGate);
    if($('#topRepSelect')) $('#topRepSelect').addEventListener('change',e=>setCurrentRep(e.target.value));
  }
  function showPageShell(){renderSidebar();renderTopbar();}
  function goManagerPage(page){currentPage=page;if(page==='editor'&&!editingCampaignId){} renderManagerPage(page);}
  function renderManagerPage(page){
    appRole='manager';currentPage=page;showPageShell();
    const main=$('#mainContent');
    if(page==='home') main.innerHTML=managerHomeHTML();
    else if(page==='campaigns') main.innerHTML=campaignListHTML();
    else if(page==='editor') main.innerHTML=campaignEditorHTML(editingCampaignId?campaignById(editingCampaignId):null);
    else if(page==='representatives') main.innerHTML=representativesHTML();
    else if(page==='reports') main.innerHTML=reportsHTML();
    else main.innerHTML=managerHomeHTML();
    attachManagerPageEvents(page);
  }
  function managerHomeHTML(){
    const all=state.campaigns;const active=all.filter(c=>c.status==='active');const configured=all.filter(c=>parseNumber(c.budget)!==null).reduce((sum,c)=>sum+Number(c.budget),0);
    const reps=state.representatives.length;
    const openPayouts=all.filter(c=>c.status==='active').reduce((sum,c)=>sum+state.representatives.reduce((s,r)=>{const sales=campaignSales(r,c.id);const p=totalEarnedPayout(c,sales);return s+(p||0)},0),0);
    const topCampaigns=sortedCampaigns().slice(0,3);
    const selected=active[0]||null;
    const near=selected?state.representatives.map(rep=>({rep,sales:campaignSales(rep,selected.id),info:progressInfo(selected,campaignSales(rep,selected.id))})).filter(x=>x.info&&!x.info.unknown&&x.info.targetEnd!==null&&x.info.remaining>=0).sort((a,b)=>a.info.remaining-b.info.remaining).slice(0,5):[];
    return `<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> مرکز کنترل کمپین‌های فروش</span><h1>نمای کلی مدیریت</h1><p>کمپین‌ها، بودجه‌های تعریف‌شده و وضعیت شبکه کارگزاران را از یک نقطه مدیریت کنید.</p></div><div class="head-actions"><button class="btn btn-primary" data-action="new-campaign">＋ طراحی کمپین جدید</button></div></div>
      <div class="stats-grid"><article class="stat-card"><div class="stat-top"><span>کل کمپین‌ها</span><span class="stat-icon blue">◈</span></div><div class="stat-value">${faDigits(all.length)}</div><div class="stat-foot">کمپین‌های ثبت‌شده</div></article><article class="stat-card"><div class="stat-top"><span>کمپین فعال</span><span class="stat-icon teal">↗</span></div><div class="stat-value">${faDigits(active.length)}</div><div class="stat-foot">در حال اجرا برای کارگزاران</div></article><article class="stat-card"><div class="stat-top"><span>کارگزاران ثبت‌شده</span><span class="stat-icon gold">♙</span></div><div class="stat-value">${faDigits(reps)}</div><div class="stat-foot">پروفایل‌های تعریف‌شده</div></article><article class="stat-card"><div class="stat-top"><span>بودجه تعریف‌شده</span><span class="stat-icon purple">◉</span></div><div class="stat-value">${configured?money(configured):'—'}</div><div class="stat-foot">جمع بودجه کمپین‌های دارای بودجه</div></article></div>
      <div class="section-title"><div><h2>کمپین‌های اخیر</h2><p>آخرین کمپین‌های ثبت‌شده و وضعیت آن‌ها</p></div><button class="btn btn-outline btn-sm" data-go-page="campaigns">مشاهده همه ←</button></div>
      ${topCampaigns.length?`<div class="campaign-grid">${topCampaigns.map(c=>campaignCardHTML(c)).join('')}</div>`:`<div class="empty-state"><div class="empty-symbol">＋</div><h3>هنوز کمپینی طراحی نشده است</h3><p>برای شروع، کمپین جدید بسازید و بودجه، حدنصاب پلکان‌ها و مبلغ پاداش هر دستگاه را به دلخواه تکمیل کنید.</p><button class="btn btn-primary" data-action="new-campaign">طراحی اولین کمپین</button></div>`}
      <div class="section-title"><div><h2>کارگزاران نزدیک به حدنصاب</h2><p>${selected?`بر اساس کمپین «${esc(selected.name)}»`:'برای مشاهده پیشرفت، ابتدا یک کمپین فعال و کارگزار ثبت کنید.'}</p></div><button class="btn btn-outline btn-sm" data-go-page="representatives">مدیریت کارگزاران ←</button></div>
      ${near.length?`<div class="panel"><div class="table-wrap"><table><thead><tr><th>کارگزار</th><th>فروش معتبر</th><th>سطح فعلی</th><th>فاصله تا تکمیل بازه</th><th>خط جاری فروش</th></tr></thead><tbody>${near.map(x=>`<tr><td><span class="table-primary">${esc(x.rep.name)}</span><span class="table-secondary">${esc(x.rep.code||'بدون کد')}</span></td><td>${integer(x.sales)} دستگاه</td><td>${levelBadgeHTML(x.info.achievedIndex,x.info.achieved?.name)}</td><td>${x.info.targetEnd===null?'—':`${faDigits(x.info.remaining)} دستگاه`}</td><td><div class="line-preview">${esc((x.info.messages||[]).join(' | '))}</div></td></tr>`).join('')}</tbody></table></div></div>`:`<div class="empty-state"><div class="empty-symbol">↗</div><h3>اطلاعات پیشرفت در دسترس نیست</h3><p>با ثبت کارگزاران و داده فروش برای یک کمپین، خط جاری فروش و فاصله تا حدنصاب‌ها در این قسمت نمایش داده می‌شود.</p></div>`}
      <div class="notice"><span class="notice-mark">i</span><span><b>یادآوری:</b> اعداد مربوط به بودجه، حدنصاب‌ها و پاداش‌ها به‌صورت پیش‌فرض خالی هستند و توسط مدیریت در فرم طراحی کمپین وارد می‌شوند.</span></div>`;
  }
  function campaignCardHTML(c){
    const end=c.tiers?.length?parseNumber(c.tiers[c.tiers.length-2]?.endQty):null;
    const tierCount=c.tiers?.length||0;
    const repsWithSales=state.representatives.filter(r=>campaignSales(r,c.id)!==null).length;
    return `<article class="campaign-card"><div class="campaign-card-top"><span class="campaign-mark">◈</span>${statusLabelHTML(c.status)}</div><div class="campaign-card-body"><h3>${esc(c.name||'کمپین بدون نام')}</h3><p class="campaign-desc">${esc(c.description||'برای این کمپین توضیحی ثبت نشده است.')}</p><div class="campaign-metrics"><div><span>بودجه</span><b>${money(parseNumber(c.budget))}</b></div><div><span>پلکان تعریف‌شده</span><b>${faDigits(tierCount)} سطح</b></div><div><span>کارگزار دارای فروش</span><b>${faDigits(repsWithSales)}</b></div><div><span>تاریخ اجرا</span><b>${esc(c.startDate||'—')} ${c.endDate?`تا ${esc(c.endDate)}`:''}</b></div></div></div><div class="campaign-card-footer"><button class="btn btn-outline btn-sm" data-edit-campaign="${esc(c.id)}">ویرایش</button><div style="display:flex;gap:6px"><button class="icon-button" data-toggle-campaign="${esc(c.id)}" title="تغییر وضعیت">${c.status==='active'?'Ⅱ':'▶'}</button><button class="icon-button" data-delete-campaign="${esc(c.id)}" title="حذف کمپین">×</button></div></div></article>`;
  }
  function campaignListHTML(){
    const sorted=sortedCampaigns();
    return `<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> فضای کاری مدیریت</span><h1>مدیریت کمپین‌ها</h1><p>کمپین بسازید، پلکان‌ها را تنظیم کنید و وضعیت هر کمپین را مدیریت کنید.</p></div><div class="head-actions"><button class="btn btn-primary" data-action="new-campaign">＋ طراحی کمپین</button></div></div><div class="toolbar"><div class="search-box"><span>⌕</span><input id="campaignSearch" placeholder="جست‌وجوی نام کمپین" autocomplete="off"></div><select id="campaignStatusFilter" class="select-control"><option value="all">همه وضعیت‌ها</option><option value="draft">پیش‌نویس</option><option value="active">فعال</option><option value="paused">متوقف</option><option value="ended">پایان‌یافته</option></select></div><div id="campaignCards" class="campaign-grid">${sorted.map(c=>campaignCardHTML(c)).join('')}</div><div id="campaignEmpty" class="empty-state ${sorted.length?'hidden':''}"><div class="empty-symbol">＋</div><h3>هنوز کمپینی ثبت نشده است</h3><p>با طراحی کمپین جدید می‌توانید بودجه، تعداد پلکان‌ها، حدنصاب و نرخ پاداش را مشخص کنید.</p><button class="btn btn-primary" data-action="new-campaign">ساخت کمپین</button></div><div class="notice"><span class="notice-mark">i</span><span>هر کمپین تنظیمات، بودجه و پلکان‌های مستقل خود را دارد. اطلاعات فرم به‌صورت پیش‌نویس نیز قابل ذخیره است و می‌توانید بعداً آن را تکمیل کنید.</span></div>`;
  }
  function campaignEditorHTML(campaign){
    const isEdit=!!campaign;
    const tiers=(campaign?.tiers?.length?campaign.tiers:defaultTiers()).map((t,i)=>({...t,id:t.id||uid('tier'),name:t.name||['برنزی','نقره‌ای','طلایی','پلاتینیوم'][i]||`سطح ${i+1}`}));
    const activeCount=campaign?state.representatives.filter(r=>campaignSales(r,campaign.id)!==null).length:0;
    return `<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> سازنده کمپین</span><h1>${isEdit?'ویرایش کمپین':'طراحی کمپین جدید'}</h1><p>تمام مبالغ به تومان هستند. فیلدهای عددی عمداً خالی‌اند تا مدیریت آن‌ها را متناسب با بودجه و هدف کمپین وارد کند.</p></div><div class="head-actions"><button class="btn btn-outline" data-go-page="campaigns">بازگشت به کمپین‌ها</button></div></div>
      <form id="campaignEditorForm" data-campaign-id="${esc(campaign?.id||'')}" novalidate><div class="form-grid"><div class="form-stack">
        <section class="form-card"><div class="form-card-head"><span class="section-number">۰۱</span><div><h2>مشخصات کمپین</h2><p>عنوان و اطلاعات اصلی که در نمای کارگزار نمایش داده می‌شود.</p></div></div><div class="form-card-body"><div class="field-grid"><label class="field"><span>نام کمپین <b class="muted">(الزامی)</b></span><input id="campaignName" value="${esc(campaign?.name||'')}" required placeholder="نام کمپین را وارد کنید"></label><label class="field"><span>وضعیت فعلی</span><input id="campaignStatusDisplay" value="${esc(statusText(campaign?.status||'draft'))}" readonly></label><label class="field full"><span>توضیحات کمپین</span><textarea id="campaignDescription" rows="3" placeholder="هدف یا توضیح کوتاه کمپین را بنویسید">${esc(campaign?.description||'')}</textarea></label><label class="field"><span>تاریخ شروع (شمسی)</span><input id="campaignStart" value="${esc(campaign?.startDate||'')}" placeholder="سال/ماه/روز"></label><label class="field"><span>تاریخ پایان (شمسی)</span><input id="campaignEnd" value="${esc(campaign?.endDate||'')}" placeholder="سال/ماه/روز"></label></div></div></section>
        <section class="form-card"><div class="form-card-head"><span class="section-number">۰۲</span><div><h2>بودجه کمپین</h2><p>سقف بودجه را به تومان وارد کنید. این فیلد به‌صورت پیش‌فرض خالی است.</p></div></div><div class="form-card-body"><div class="field-grid"><label class="field"><span>بودجه مصوب کمپین</span><div class="currency-wrap"><input id="campaignBudget" type="number" min="0" step="1000" inputmode="numeric" value="${campaign?.budget??''}" placeholder="" aria-label="بودجه کمپین به تومان"><span class="currency-unit">تومان</span></div><small class="help-text">مبلغ بودجه به‌عنوان سقف برنامه‌ریزی کمپین ثبت می‌شود.</small></label><label class="field"><span>هدف فروش (اختیاری)</span><div class="currency-wrap"><input id="campaignTarget" type="number" min="0" step="1" inputmode="numeric" value="${campaign?.targetQty??''}" placeholder="" aria-label="هدف فروش به تعداد دستگاه"><span class="currency-unit">دستگاه</span></div><small class="help-text">در صورت عدم نیاز، خالی بگذارید.</small></label></div></div></section>
        <section class="form-card"><div class="form-card-head"><span class="section-number">۰۳</span><div><h2>تعریف پلکان‌ها و نرخ پاداش</h2><p>نام، حدنصاب پایان بازه و پاداش هر دستگاه را مطابق طراحی کمپین وارد کنید.</p></div></div><div class="form-card-body"><div class="form-note">تعدادها بر اساس فروش تجمعی محاسبه می‌شوند. هر پلکان از یک دستگاه پس از پایان پلکان قبلی آغاز می‌شود. آخرین پلکان سقف ندارد و نرخ آن برای هر دستگاه پس از حدنصاب قبلی اعمال می‌شود. مبلغ پاداش فقط برای دستگاه‌های همان بازه محاسبه می‌شود.</div><div class="table-wrap" style="margin-top:13px"><table class="tier-table"><thead><tr><th>نام سطح</th><th>حد پایان بازه (دستگاه)</th><th>پاداش هر دستگاه (تومان)</th><th>حذف</th></tr></thead><tbody id="tierEditorRows">${tierRowsHTML(tiers)}</tbody></table></div><div class="tier-actions"><button type="button" class="btn btn-outline btn-sm" id="addTierBtn">＋ افزودن پلکان</button><button type="button" class="btn btn-quiet btn-sm" id="resetTierNames">بازگردانی نام چهار سطح اصلی</button></div><small class="help-text">برای فعال‌سازی کمپین، همه نرخ‌های پاداش و حد پایان پلکان‌های غیرنهایی باید تکمیل و به ترتیب صعودی باشند. عددی از پیش وارد نشده است.</small></div></section>
        <section class="form-card"><div class="form-card-head"><span class="section-number">۰۴</span><div><h2>پیش‌نمایش و ذخیره</h2><p>پیش از فعال‌سازی، وضعیت و محاسبات را بررسی کنید.</p></div></div><div class="form-card-body"><div id="editorValidation" class="form-note">می‌توانید کمپین را به‌صورت پیش‌نویس ذخیره کنید و فیلدهای عددی را بعداً تکمیل نمایید.</div><div id="editorBudgetPreview" class="budget-summary" style="margin-top:12px"><div class="summary-label">برآورد فعلی بر اساس فروش کارگزاران</div><div class="summary-value">—</div><div class="budget-row"><span>بودجه کمپین</span><b>تعیین نشده</b></div><div class="budget-row"><span>پاداش ثبت‌شده</span><b>تعیین نشده</b></div></div></div><div class="form-actions"><button type="button" class="btn btn-outline" data-go-page="campaigns">انصراف</button><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-outline" id="saveDraftBtn">ذخیره پیش‌نویس</button><button type="button" class="btn btn-primary" id="activateCampaignBtn">ذخیره و فعال‌سازی</button></div></div></section>
      </div><aside class="form-stack"><div class="panel"><div class="panel-heading"><div><h3>خلاصه تنظیمات</h3><p>اطلاعات بر اساس فرم به‌روزرسانی می‌شوند.</p></div></div><div class="panel-pad"><div class="budget-row"><span>نام کمپین</span><b id="summaryName">${esc(campaign?.name||'—')}</b></div><div class="budget-row"><span>وضعیت</span><b id="summaryStatus">${statusText(campaign?.status||'draft')}</b></div><div class="budget-row"><span>بودجه</span><b id="summaryBudget">${money(parseNumber(campaign?.budget))}</b></div><div class="budget-row"><span>تعداد پلکان</span><b id="summaryTiers">${faDigits(tiers.length)}</b></div><div class="budget-row"><span>کارگزاران دارای سابقه فروش</span><b>${faDigits(activeCount)}</b></div></div></div><div class="panel"><div class="panel-heading"><div><h3>قواعد محاسبه</h3><p>قواعد عمومی مدل پاداش</p></div></div><div class="panel-pad"><div class="form-note">۱. نرخ هر دستگاه بر اساس بازه فروش همان دستگاه محاسبه می‌شود.<br>۲. نرخ بازه جدید به فروش‌های قبلی تسری پیدا نمی‌کند.<br>۳. پاداش هر بازه پس از تکمیل حدنصاب و تأیید فروش‌های معتبر آن قابل پرداخت است.<br>۴. آخرین پلکان برای فروش‌های بالاتر از حدنصاب نهایی ادامه پیدا می‌کند.</div></div></div></aside></div></form>`;
  }
  function tierRowsHTML(tiers){
    return tiers.map((t,i)=>`<tr data-tier-row="${i}"><td><input class="tier-name-input" data-tier-name value="${esc(t.name||'')}" placeholder="نام سطح"></td><td><input data-tier-end type="number" min="1" step="1" inputmode="numeric" value="${i===tiers.length-1?'':(t.endQty??'')}" placeholder="${i===tiers.length-1?'بدون سقف':''}" ${i===tiers.length-1?'disabled':''} aria-label="حد پایان بازه ${i+1}"></td><td><div class="currency-wrap"><input data-tier-reward type="number" min="0" step="1000" inputmode="numeric" value="${t.reward??''}" placeholder="" aria-label="پاداش هر دستگاه سطح ${i+1}"><span class="currency-unit">تومان</span></div></td><td><button type="button" class="icon-button" data-remove-tier="${i}" title="حذف پلکان" ${tiers.length===1?'disabled':''}>×</button></td></tr>`).join('');
  }
  function readTierRows(){
    const rows=$$('[data-tier-row]');
    return rows.map((row,i)=>({id:uid('tier'),name:$('[data-tier-name]',row).value.trim(),endQty:i===rows.length-1?null:parseNumber($('[data-tier-end]',row).value),reward:parseNumber($('[data-tier-reward]',row).value)}));
  }
  function readCampaignForm(status){
    return {
      id:editingCampaignId||uid('campaign'),name:$('#campaignName').value.trim(),description:$('#campaignDescription').value.trim(),startDate:$('#campaignStart').value.trim(),endDate:$('#campaignEnd').value.trim(),budget:parseNumber($('#campaignBudget').value),targetQty:parseNumber($('#campaignTarget').value),tiers:readTierRows(),status,createdAt:campaignById(editingCampaignId)?.createdAt||Date.now(),updatedAt:Date.now()
    };
  }
  function editorValidate(campaign){
    const errors=[];
    if(!campaign.name)errors.push('نام کمپین را وارد کنید.');
    if(campaign.budget===null||campaign.budget<=0)errors.push('بودجه کمپین باید تعیین شود.');
    let previous=0;
    campaign.tiers.forEach((t,i)=>{
      if(!t.name)errors.push(`نام سطح ${i+1} را وارد کنید.`);
      if(t.reward===null||t.reward<=0)errors.push(`مبلغ پاداش هر دستگاه در سطح «${t.name||i+1}» را وارد کنید.`);
      if(i<campaign.tiers.length-1){
        if(t.endQty===null||t.endQty<=previous)errors.push(`حد پایان بازه سطح «${t.name||i+1}» را وارد کنید؛ حدنصاب‌ها باید افزایشی باشند.`);
        else previous=t.endQty;
      }
    });
    if(campaign.startDate && campaign.endDate && campaign.startDate>campaign.endDate) errors.push('تاریخ پایان را پس از تاریخ شروع وارد کنید.');
    return errors;
  }
  function persistCampaignFromForm(status){
    const campaign=readCampaignForm(status);
    if(!campaign.name){toast('برای ذخیره، نام کمپین را وارد کنید.','error');$('#campaignName').focus();return;}
    if(status==='active'){
      const errors=editorValidate(campaign);
      if(errors.length){$('#editorValidation').innerHTML=`<strong>برای فعال‌سازی، این موارد را تکمیل کنید:</strong><br>${errors.map(esc).join('<br>')}`;toast('اطلاعات لازم برای فعال‌سازی کامل نیست.','error');return;}
    }
    if(status==='active' && campaign.status==='active' && !campaignConfigured(campaign)){toast('تنظیمات پلکان‌ها کامل نیست.','error');return;}
    const idx=state.campaigns.findIndex(c=>c.id===campaign.id);
    if(idx>=0)state.campaigns[idx]=campaign;else state.campaigns.unshift(campaign);
    if(persist()){editingCampaignId=null;selectedCampaignId=campaign.id;toast(status==='active'?'کمپین ذخیره و فعال شد.':'پیش‌نویس کمپین ذخیره شد.');renderManagerPage('campaigns');}
  }
  function updateEditorPreview(){
    const name=$('#campaignName')?.value.trim()||'—';const budget=parseNumber($('#campaignBudget')?.value);const status=campaignById(editingCampaignId)?.status||'draft';const tiers=readTierRows();
    const $name=$('#summaryName'),$status=$('#summaryStatus'),$budget=$('#summaryBudget'),$tiers=$('#summaryTiers');
    if($name)$name.textContent=name;if($status)$status.textContent=statusText(status);if($budget)$budget.textContent=money(budget);if($tiers)$tiers.textContent=faDigits(tiers.length);
    const existing=campaignById(editingCampaignId); const temp={...(existing||{}),id:editingCampaignId||'__draft__',tiers,budget};
    const availableReps=state.representatives.reduce((sum,r)=>sum+(campaignSales(r,temp.id)||0),0);
    const rewardForecast=state.representatives.reduce((sum,r)=>{const sold=campaignSales(r,temp.id);const p=totalEarnedPayout(temp,sold);return sum+(p||0)},0);
    const preview=$('#editorBudgetPreview');
    if(preview){
      const budgetDisplay=budget===null?'تعیین نشده':money(budget);const rewardDisplay=tiers.every(t=>t.reward!==null)?money(rewardForecast):'پس از تکمیل نرخ‌ها';
      const remaining=budget===null?null:budget-rewardForecast;
      preview.innerHTML=`<div class="summary-label">برآورد ثبت‌شده بر اساس فروش واردشده</div><div class="summary-value">${budget===null?'—':money(Math.max(0,remaining))}</div><div class="budget-row"><span>بودجه کمپین</span><b>${budgetDisplay}</b></div><div class="budget-row"><span>پاداش محاسبه‌شده برای فروش‌های ثبت‌شده</span><b>${rewardDisplay}</b></div><div class="budget-row"><span>وضعیت بودجه</span><b>${budget===null?'در انتظار تعیین بودجه':rewardForecast>budget?'بیشتر از بودجه': 'در محدوده بودجه'}</b></div>`;
    }
  }
  function campaignCardActions(target){
    const edit=target.closest('[data-edit-campaign]');if(edit){editingCampaignId=edit.dataset.editCampaign;renderManagerPage('editor');return true;}
    const del=target.closest('[data-delete-campaign]');if(del){const c=campaignById(del.dataset.deleteCampaign);if(!c)return true;if(!confirm(`کمپین «${c.name}» حذف شود؟`))return true;state.campaigns=state.campaigns.filter(x=>x.id!==c.id);state.representatives.forEach(r=>{if(r.salesByCampaign)delete r.salesByCampaign[c.id]});persist();toast('کمپین حذف شد.');renderManagerPage(currentPage==='home'?'home':'campaigns');return true;}
    const toggle=target.closest('[data-toggle-campaign]');if(toggle){const c=campaignById(toggle.dataset.toggleCampaign);if(!c)return true;const next=c.status==='active'?'paused':'active';if(next==='active'&&!campaignConfigured(c)){toast('ابتدا نام، بودجه، حدنصاب‌ها و نرخ پاداش همه پلکان‌ها را تکمیل کنید.','error');return true;}c.status=next;c.updatedAt=Date.now();persist();toast(next==='active'?'کمپین فعال شد.':'کمپین متوقف شد.');renderManagerPage(currentPage);return true;}
    return false;
  }
  function managerClickHandler(e){
    const target=e.target;
    const newBtn=target.closest('[data-action="new-campaign"]');if(newBtn){editingCampaignId=null;renderManagerPage('editor');return;}
    const saveSales=target.closest('[data-save-sales]');if(saveSales){const rep=repById(saveSales.dataset.saveSales);const campaignId=$('#repCampaignContext')?.value||'';if(!rep||!campaignId){toast('ابتدا یک کمپین را انتخاب کنید.','error');return;}const input=$(`#sales-${CSS.escape(rep.id)}`);const value=normalizeSaleCount(input?.value);rep.salesByCampaign=rep.salesByCampaign||{};rep.salesByCampaign[campaignId]=value;persist();toast(value===null?'فروش به حالت ثبت‌نشده تغییر کرد.':'فروش کارگزار به‌روزرسانی شد.');renderManagerPage('representatives');return;}
    const editRep=target.closest('[data-edit-rep]');if(editRep){const rep=repById(editRep.dataset.editRep);if(!rep)return;const name=prompt('نام کارگزار',rep.name);if(name===null)return;if(!name.trim()){toast('نام کارگزار نمی‌تواند خالی باشد.','error');return;}const code=prompt('کد کارگزار',rep.code||'');if(code===null)return;const phone=prompt('شماره تماس (اختیاری)',rep.phone||'');if(phone===null)return;rep.name=name.trim();rep.code=code.trim();rep.phone=phone.trim();persist();toast('اطلاعات کارگزار به‌روزرسانی شد.');renderManagerPage('representatives');return;}
    const delRep=target.closest('[data-delete-rep]');if(delRep){const rep=repById(delRep.dataset.deleteRep);if(!rep)return;if(!confirm(`کارگزار «${rep.name}» حذف شود؟`))return;state.representatives=state.representatives.filter(r=>r.id!==rep.id);if(currentRepId===rep.id)currentRepId=state.representatives[0]?.id||null;persist();toast('کارگزار حذف شد.');renderManagerPage('representatives');return;}
    if(campaignCardActions(target))return;
  }
  function bindTierRemove(){
    $$('[data-remove-tier]').forEach(btn=>btn.addEventListener('click',()=>{const tiers=readTierRows();if(tiers.length<=1){toast('حداقل یک پلکان لازم است.','error');return;}tiers.splice(Number(btn.dataset.removeTier),1);$('#tierEditorRows').innerHTML=tierRowsHTML(tiers);bindTierRemove();updateEditorPreview();}));
  }
  function filterCampaignCards(){
    const q=($('#campaignSearch')?.value||'').trim().toLowerCase();const status=$('#campaignStatusFilter')?.value||'all';const filtered=sortedCampaigns().filter(c=>(!q||String(c.name||'').toLowerCase().includes(q))&&(status==='all'||c.status===status));
    $('#campaignCards').innerHTML=filtered.map(c=>campaignCardHTML(c)).join('');$('#campaignEmpty').classList.toggle('hidden',state.campaigns.length>0);if(!filtered.length&&state.campaigns.length)$('#campaignCards').innerHTML='<div class="empty-state"><h3>نتیجه‌ای پیدا نشد</h3><p>عبارت جست‌وجو یا وضعیت کمپین را تغییر دهید.</p></div>';
  }
  function representativesHTML(){
    const campaigns=sortedCampaigns();if(!selectedCampaignId||!campaignById(selectedCampaignId))selectedCampaignId=(activeCampaigns()[0]||campaigns[0])?.id||null;
    const c=campaignById(selectedCampaignId);
    return `<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> مدیریت شبکه فروش</span><h1>کارگزاران</h1><p>اطلاعات هر کارگزار، تعداد فروش، سطح فعلی، پاداش و خط جاری فروش را مشاهده و مدیریت کنید.</p></div></div>
      <section class="form-card" style="margin-bottom:17px"><div class="form-card-head"><span class="section-number">+</span><div><h2>ثبت کارگزار جدید</h2><p>اطلاعات اولیه را وارد کنید؛ فروش هر کمپین بعداً قابل ثبت و ویرایش است.</p></div></div><div class="form-card-body"><form id="newRepForm" class="inline-form"><label class="field"><span>نام کارگزار</span><input id="newRepName" required placeholder="نام و نام خانوادگی یا نام مجموعه"></label><label class="field"><span>کد کارگزار</span><input id="newRepCode" placeholder="اختیاری"></label><label class="field"><span>شماره تماس</span><input id="newRepPhone" type="tel" placeholder="اختیاری"></label><button class="btn btn-primary" type="submit">＋ افزودن کارگزار</button></form></div></section>
      <div class="panel"><div class="panel-heading"><div><h3>فهرست کارگزاران و پیشرفت کمپین</h3><p>خط جاری فروش این جدول، همان پیامی است که کارگزار در PWA مشاهده می‌کند.</p></div><div class="campaign-context"><label for="repCampaignContext">کمپین مبنا</label><select id="repCampaignContext" class="select-control" ${campaigns.length?'':'disabled'}>${campaignOptionList(selectedCampaignId,false)}</select></div></div>
      ${state.representatives.length?`<div class="table-wrap"><table><thead><tr><th>کارگزار</th><th>فروش معتبر</th><th>سطح فعلی</th><th>پاداش تکمیل‌شده</th><th>ثبت / ویرایش فروش</th><th>خط جاری فروش در PWA</th><th>عملیات</th></tr></thead><tbody>${state.representatives.map(rep=>repRowHTML(rep,c)).join('')}</tbody></table></div>`:`<div class="table-empty">هنوز کارگزاری ثبت نشده است. ابتدا فرم بالا را تکمیل کنید.</div>`}</div>
      <div class="notice"><span class="notice-mark">i</span><span>برای هر نماینده، پیام فروش، سطح و پاداش بر اساس کمپین انتخاب‌شده محاسبه می‌شود. مقدار فروش با ثبت مدیریت ذخیره می‌شود و برای کارگزار در نمای PWA قابل مشاهده خواهد بود.</span></div>`;
  }
  function repRowHTML(rep,campaign){
    const sales=campaign?campaignSales(rep,campaign.id):null;const info=campaign?progressInfo(campaign,sales):null;
    const level=info&&!info.unknown?levelBadgeHTML(info.achievedIndex,info.achieved?.name||(sales===0?'در انتظار اولین فروش':'هنوز سطحی کسب نشده')):levelBadgeHTML(-1,'تنظیم نشده');
    const earned=info&&!info.unknown?money(info.earned):'—';
    const line=info?((info.messages||[info.message]).filter(Boolean).join(' | ')||'هنوز پیام فروش تولید نشده است.'):'ابتدا کمپین تعریف کنید.';
    return `<tr><td><span class="table-primary">${esc(rep.name)}</span><span class="table-secondary">${esc(rep.code||'بدون کد')}${rep.phone?` · ${esc(rep.phone)}`:''}</span></td><td>${sales===null?'ثبت نشده':`${faDigits(sales)} دستگاه`}</td><td>${level}</td><td><span class="money">${earned}</span></td><td>${campaign?`<div style="display:flex;gap:6px;align-items:center"><input class="sales-input" id="sales-${esc(rep.id)}" type="number" min="0" step="1" inputmode="numeric" value="${sales??''}" placeholder="تعداد"><button class="btn btn-primary btn-sm" data-save-sales="${esc(rep.id)}">ثبت</button></div>`:'—'}</td><td><div class="line-preview">${esc(line)}</div></td><td><div style="display:flex;gap:5px"><button class="icon-button" data-edit-rep="${esc(rep.id)}" title="ویرایش کارگزار">✎</button><button class="icon-button" data-delete-rep="${esc(rep.id)}" title="حذف کارگزار">×</button></div></td></tr>`;
  }
  function reportsHTML(){
    const all=sortedCampaigns();const chosen=campaignById(selectedCampaignId)||activeCampaigns()[0]||all[0]||null;if(chosen)selectedCampaignId=chosen.id;
    const reports=chosen?state.representatives.map(rep=>{const sales=campaignSales(rep,chosen.id);const info=progressInfo(chosen,sales);return {rep,sales,info}}):[];
    const sold=reports.reduce((s,r)=>s+(r.sales||0),0);const payout=reports.reduce((s,r)=>s+((r.info&&!r.info.unknown&&r.info.earned)||0),0);const registered=reports.filter(r=>r.sales!==null).length;const levels=[0,1,2,3].map(i=>({i,count:reports.filter(r=>r.info&&!r.info.unknown&&r.info.achievedIndex===i).length}));
    return `<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> تحلیل عملکرد</span><h1>گزارش‌های مدیریتی</h1><p>خلاصه فروش، توزیع سطح نمایندگان و تعهد پاداش بر اساس داده‌های ثبت‌شده.</p></div><div class="head-actions"><button class="btn btn-outline" id="exportReportBtn">خروجی CSV</button></div></div>
    <div class="toolbar"><span class="muted small">کمپین گزارش</span><select id="reportCampaignSelect" class="select-control">${campaignOptionList(chosen?.id,false)}</select></div>
    ${chosen?`<div class="stats-grid"><article class="stat-card"><div class="stat-top"><span>فروش ثبت‌شده</span><span class="stat-icon blue">↗</span></div><div class="stat-value">${faDigits(sold)}</div><div class="stat-foot">مجموع فروش واردشده برای این کمپین</div></article><article class="stat-card"><div class="stat-top"><span>کارگزار دارای داده فروش</span><span class="stat-icon teal">♙</span></div><div class="stat-value">${faDigits(registered)}</div><div class="stat-foot">از ${faDigits(state.representatives.length)} کارگزار ثبت‌شده</div></article><article class="stat-card"><div class="stat-top"><span>پاداش تکمیل‌شده</span><span class="stat-icon gold">✦</span></div><div class="stat-value">${payout?money(payout):'—'}</div><div class="stat-foot">جمع بر اساس بازه‌های تکمیل‌شده</div></article><article class="stat-card"><div class="stat-top"><span>بودجه کمپین</span><span class="stat-icon purple">◉</span></div><div class="stat-value">${money(parseNumber(chosen.budget))}</div><div class="stat-foot">سقف تعریف‌شده توسط مدیریت</div></article></div>
    <div class="section-title"><div><h2>توزیع کارگزاران در سطوح</h2><p>سطح هر کارگزار بر اساس فروش ثبت‌شده برای این کمپین</p></div></div><div class="stats-grid">${levels.map(l=>`<article class="stat-card"><div class="stat-top"><span>${esc(chosen.tiers[l.i]?.name||`سطح ${l.i+1}`)}</span><span class="stat-icon ${['gold','blue','teal','purple'][l.i]}">${tierIcon(l.i)}</span></div><div class="stat-value">${faDigits(l.count)}</div><div class="stat-foot">کارگزار</div></article>`).join('')}</div>
    <div class="section-title"><div><h2>جزئیات عملکرد کارگزاران</h2><p>شامل خط جاری فروش برای هر کارگزار</p></div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>کارگزار</th><th>فروش معتبر</th><th>سطح فعلی</th><th>پاداش تکمیل‌شده</th><th>فاصله تا تکمیل بازه</th><th>خط جاری فروش</th></tr></thead><tbody>${reports.map(r=>{const i=r.info;return `<tr><td><span class="table-primary">${esc(r.rep.name)}</span><span class="table-secondary">${esc(r.rep.code||'بدون کد')}</span></td><td>${r.sales===null?'ثبت نشده':`${faDigits(r.sales)} دستگاه`}</td><td>${i&&!i.unknown?levelBadgeHTML(i.achievedIndex,i.achieved?.name||(r.sales===0?'در انتظار اولین فروش':'هنوز سطحی کسب نشده')):levelBadgeHTML(-1,'—')}</td><td>${i&&!i.unknown?money(i.earned):'—'}</td><td>${i&&!i.unknown&&i.targetEnd!==null?`${faDigits(i.remaining)} دستگاه`:'—'}</td><td><div class="line-preview">${esc((i?.messages||[i?.message]).filter(Boolean).join(' | ')||'اطلاعات کافی موجود نیست.')}</div></td></tr>`}).join('')}</tbody></table></div></div>`:`<div class="empty-state"><div class="empty-symbol">▤</div><h3>هنوز کمپینی وجود ندارد</h3><p>پس از ایجاد کمپین، گزارش فروش و وضعیت کارگزاران در این بخش نمایش داده می‌شود.</p><button class="btn btn-primary" data-action="new-campaign">طراحی کمپین</button></div>`}`;
  }
  function attachReportEvents(){
    $('#reportCampaignSelect')?.addEventListener('change',e=>{selectedCampaignId=e.target.value||null;renderManagerPage('reports')});
    $('#exportReportBtn')?.addEventListener('click',exportReportCSV);
  }
  function exportReportCSV(){
    const campaign=campaignById($('#reportCampaignSelect')?.value||selectedCampaignId);if(!campaign){toast('کمپینی برای خروجی انتخاب نشده است.','error');return;}
    const rows=[['نام کارگزار','کد کارگزار','فروش معتبر','سطح فعلی','پاداش تکمیل‌شده','پیام خط جاری فروش']];
    state.representatives.forEach(rep=>{const sale=campaignSales(rep,campaign.id);const info=progressInfo(campaign,sale);rows.push([rep.name,rep.code||'',sale===null?'':sale,info&&!info.unknown?info.achieved?.name:'',info&&!info.unknown?info.earned:'',info?.messages?.join(' | ')||'']);});
    const csv='\uFEFF'+rows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`techno-campgain-report-${campaign.id}.csv`;a.click();URL.revokeObjectURL(url);toast('فایل CSV گزارش آماده شد.');
  }
  function attachManagerPageEvents(page){
    const main=$('#mainContent');
    main.onclick=managerClickHandler;
    if(page==='campaigns'){
      $('#campaignSearch')?.addEventListener('input',filterCampaignCards);
      $('#campaignStatusFilter')?.addEventListener('change',filterCampaignCards);
    }
    if(page==='editor'){
      $('#addTierBtn')?.addEventListener('click',()=>{const tiers=readTierRows();tiers.push({id:uid('tier'),name:`سطح ${tiers.length+1}`,endQty:null,reward:null});$('#tierEditorRows').innerHTML=tierRowsHTML(tiers);bindTierRemove();updateEditorPreview();});
      $('#resetTierNames')?.addEventListener('click',()=>{const tiers=readTierRows();const names=['برنزی','نقره‌ای','طلایی','پلاتینیوم'];tiers.forEach((t,i)=>{if(names[i])t.name=names[i]});$('#tierEditorRows').innerHTML=tierRowsHTML(tiers);bindTierRemove();updateEditorPreview();});
      bindTierRemove();$('#campaignEditorForm')?.addEventListener('input',updateEditorPreview);
      $('#saveDraftBtn')?.addEventListener('click',()=>persistCampaignFromForm('draft'));
      $('#activateCampaignBtn')?.addEventListener('click',()=>persistCampaignFromForm('active'));
      updateEditorPreview();
    }
    if(page==='representatives'){
      $('#repCampaignContext')?.addEventListener('change',e=>{selectedCampaignId=e.target.value||null;renderManagerPage('representatives')});
      $('#newRepForm')?.addEventListener('submit',e=>{e.preventDefault();const name=$('#newRepName').value.trim();if(!name){toast('نام کارگزار را وارد کنید.','error');return;}const rep={id:uid('rep'),name,code:$('#newRepCode').value.trim(),phone:$('#newRepPhone').value.trim(),salesByCampaign:{},createdAt:Date.now()};state.representatives.push(rep);persist();toast('کارگزار ثبت شد.');renderManagerPage('representatives');});
    }
    if(page==='reports') attachReportEvents();
  }
  function brokerDashboardHTML(){
    const rep=repById(currentRepId);const live=activeCampaigns();const campaign=live.find(c=>c.id===selectedCampaignId)||live[0]||null;if(campaign)selectedCampaignId=campaign.id;
    const hasRep=!!rep;
    if(!hasRep){return `<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> فضای اختصاصی کارگزار</span><h1>داشبورد کارگزار</h1><p>برای مشاهده مسیر فروش، ابتدا کارگزار را در پنل مدیریت ثبت کنید.</p></div></div><div class="empty-state"><div class="empty-symbol">♙</div><h3>هنوز کارگزاری برای نمایش وجود ندارد</h3><p>از منوی «تغییر دسترسی» به پنل مدیریت بروید، کارگزار را ثبت کنید و سپس فروش او را به کمپین مربوط اختصاص دهید.</p><button class="btn btn-primary" data-go-gate>بازگشت و انتخاب دسترسی</button></div>`;}
    if(!campaign){return `<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> فضای اختصاصی کارگزار</span><h1>سلام ${esc(rep.name)}</h1><p>وضعیت و پاداش کمپین شما در این بخش نمایش داده می‌شود.</p></div></div><div class="empty-state"><div class="empty-symbol">◈</div><h3>کمپین فعالی برای نمایش وجود ندارد</h3><p>پس از فعال‌سازی کمپین توسط مدیریت، سطح، خط جاری فروش و پاداش شما نمایش داده می‌شود.</p></div>`;}
    const sales=campaignSales(rep,campaign.id);const info=progressInfo(campaign,sales);const tiers=campaign.tiers||[];
    if(!info || info.unknown){return `<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> فضای اختصاصی کارگزار</span><h1>سلام ${esc(rep.name)}</h1><p>کمپین: ${esc(campaign.name)}</p></div></div><div class="empty-state"><div class="empty-symbol">↗</div><h3>خط جاری فروش آماده نمایش نیست</h3><p>${esc(info?.message||'مدیریت هنوز ساختار پلکان‌ها یا میزان فروش شما را تکمیل نکرده است.')}</p></div>`;}
    const nextTier=sales<info.targetStart?info.target:(info.targetIndex<tiers.length-1?tiers[info.targetIndex+1]:null);
    const paid=info.earned;const blockAmount=info.blockReward;
    const levelSteps=tiers.map((t,i)=>{
      const end=tierFiniteEnd(t,i,tiers);const start=tierStart(tiers,i);const reached=sales!==null && (end===null?sales>=start:sales>=end);const active=i===info.achievedIndex;
      const pct=end===null? (sales>=start?100:0):Math.max(0,Math.min(100,((sales-start+1)/(end-start+1))*100));
      return `<div class="tier-step ${reached?'reached':''}"><div class="tier-step-bar"><span style="width:${pct}%"></span></div><span class="step-name">${esc(t.name)}</span><span class="step-threshold">${end===null?`از ${faDigits(start)} به بعد`:`تا ${faDigits(end)} دستگاه`}</span></div>`;
    }).join('');
    const ticker=tickerHTML(info.messages);
    return `<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> فضای اختصاصی کارگزار</span><h1>داشبورد فروش من</h1><p>مسیر پیشرفت، مبلغ پاداش و هدف بعدی را در یک نگاه دنبال کنید.</p></div><div class="head-actions"><select id="brokerCampaignSelect" class="select-control" aria-label="انتخاب کمپین">${live.map(c=>`<option value="${esc(c.id)}" ${c.id===campaign.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div></div>
      ${ticker}
      <section class="broker-hero"><div class="hero-copy"><div class="hero-greeting">خوش آمدید، ${esc(rep.name)}</div><h2>${esc(campaign.name)}</h2><p>${esc(campaign.description||'فروش معتبر خود را ثبت کنید، بازه‌های پاداش را تکمیل کنید و برای رسیدن به سطح بالاتر پیش بروید.')}</p></div><div class="hero-level"><div class="level-caption">سطح فعلی شما</div><div class="level-name">${esc(info.achieved?.name||'هنوز سطحی کسب نشده')}</div><div class="level-count">${faDigits(sales)} دستگاه فروش معتبر</div></div></section>
      <div class="broker-stats"><article class="broker-stat"><div class="label">فروش معتبر ثبت‌شده</div><div class="value">${faDigits(sales)}</div><div class="foot">دستگاه در کمپین جاری</div></article><article class="broker-stat"><div class="label">پاداش بازه‌های تکمیل‌شده</div><div class="value">${money(paid)}</div><div class="foot">بر اساس نرخ‌های تعریف‌شده</div></article><article class="broker-stat"><div class="label">فاصله تا تکمیل بازه هدف</div><div class="value">${info.targetEnd===null?(sales<info.targetStart?faDigits(info.targetStart-sales):'—'):faDigits(info.remaining)}</div><div class="foot">${info.targetEnd===null?(sales<info.targetStart?'دستگاه تا ورود به پلاتینیوم':'در بالاترین سطح هستید'):'دستگاه تا تکمیل بازه جاری'}</div></article></div>
      <section class="progress-panel"><div class="progress-panel-head"><div><h3>مسیر سطح‌بندی شما</h3><p>از سطح فعلی تا بالاترین سطح کمپین</p></div><div class="progress-big">${nextTier?`گام بعدی: ${esc(nextTier.name)}`:'بالاترین سطح'}</div></div><div class="tier-track">${levelSteps}</div>
        <div class="reward-progress-card"><div><h4>${info.targetEnd===null?(sales<info.targetStart?'هدف بعدی: سطح پلاتینیوم':'پاداش سطح پلاتینیوم'):'پاداش قابل دریافت با تکمیل بازه جاری'}</h4><p>${info.targetEnd===null?(sales<info.targetStart?`با ${faDigits(info.targetStart-sales)} فروش معتبر دیگر وارد پلاتینیوم می‌شوید؛ پس از آن هر دستگاه با نرخ ${money(parseNumber(info.target.reward))} محاسبه می‌شود.`:`هر دستگاه معتبر جدید با نرخ ${money(parseNumber(info.target.reward))} محاسبه می‌شود.`):`با ${faDigits(info.remaining)} فروش معتبر دیگر، بازه ${esc(info.target.name)} تکمیل و پاداش ${money(blockAmount)} قابل دریافت خواهد شد.`}</p></div><div class="reward-amount"><strong>${info.targetEnd===null?money(parseNumber(info.target.reward)):money(blockAmount)}</strong><small>${info.targetEnd===null?'به‌ازای هر دستگاه':'پاداش کل بازه پس از تکمیل'}</small></div></div>
      </section>
      <div class="broker-two-col"><section class="panel"><div class="panel-heading"><div><h3>جزئیات پلکان‌های پاداش</h3><p>نرخ هر بازه فقط برای دستگاه‌های همان بازه اعمال می‌شود.</p></div></div><div class="panel-pad"><div class="level-cards">${tiers.map((t,i)=>{const start=tierStart(tiers,i),end=tierFiniteEnd(t,i,tiers),r=parseNumber(t.reward);const complete=end!==null&&sales>=end;return `<div class="level-card"><span class="level-medal ${tierClass(i)}">${tierIcon(i)}</span><div class="level-card-body"><b>${esc(t.name)}</b><small>${end===null?`از دستگاه ${faDigits(start)} به بعد`:`دستگاه ${faDigits(start)} تا ${faDigits(end)}`}</small></div><div class="level-card-value"><b>${money(r)}</b><small>${complete?'بازه تکمیل‌شده':end===null?'نرخ دستگاه':'به‌ازای هر دستگاه'}</small></div></div>`}).join('')}</div></div></section><section class="panel"><div class="panel-heading"><div><h3>وضعیت پاداش</h3><p>پاداش کسب‌شده را از پاداش بازه در حال تکمیل جدا کنید.</p></div></div><div class="panel-pad"><div class="budget-row"><span>پاداش بازه‌های تکمیل‌شده</span><b>${money(paid)}</b></div><div class="budget-row"><span>بازه در حال تکمیل</span><b>${esc(info.target.name)}</b></div><div class="budget-row"><span>پاداش در صورت تکمیل این بازه</span><b>${info.targetEnd===null?(sales<info.targetStart?'پس از ورود، به‌ازای هر دستگاه': 'به‌ازای هر دستگاه'):money(blockAmount)}</b></div><div class="budget-row"><span>وضعیت فروش ثبت‌شده</span><b>تأییدشده توسط مدیریت</b></div><div class="form-note" style="margin-top:13px">پاداش بازه‌های دارای حدنصاب پس از تکمیل و تأیید فروش معتبر آن بازه قابل پرداخت است. در سطح پلاتینیوم، نرخ تعریف‌شده برای دستگاه‌های آن بازه اعمال می‌شود.</div></div></section></div>`;
  }
  function renderBrokerPage(){
    appRole='broker';currentPage='agent';showPageShell();$('#mainContent').innerHTML=brokerDashboardHTML();
    $('#brokerCampaignSelect')?.addEventListener('change',e=>{selectedCampaignId=e.target.value||null;renderBrokerPage()});
    $('#mainContent').onclick=e=>{if(e.target.closest('[data-go-gate]'))goRoleGate();};
  }
  function renderBrokerRules(){
    currentPage='agent-rules';showPageShell();const rep=repById(currentRepId);const campaign=activeCampaigns().find(c=>c.id===selectedCampaignId)||activeCampaigns()[0]||null;
    if(!campaign){$('#mainContent').innerHTML='<div class="empty-state"><h3>کمپین فعال وجود ندارد</h3><p>پس از فعال‌سازی کمپین توسط مدیریت، شرایط و نرخ پاداش در این بخش نمایش داده می‌شود.</p></div>';return;}
    $('#mainContent').innerHTML=`<div class="page-head"><div><span class="eyebrow"><i class="dot"></i> راهنمای کمپین</span><h1>سطوح و پاداش‌ها</h1><p>جزئیات پلکان و نرخ پاداش در کمپین ${esc(campaign.name)}</p></div><button class="btn btn-outline" data-go-page="agent">بازگشت به داشبورد</button></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>سطح</th><th>بازه فروش</th><th>پاداش هر دستگاه</th><th>پاداش کل بازه</th></tr></thead><tbody>${campaign.tiers.map((t,i)=>{const start=tierStart(campaign.tiers,i),end=tierFiniteEnd(t,i,campaign.tiers);return `<tr><td>${levelBadgeHTML(i,t.name)}</td><td>${end===null?`از ${faDigits(start)} به بعد`:`${faDigits(start)} تا ${faDigits(end)}`}</td><td>${money(parseNumber(t.reward))}</td><td>${payoutPerTier(campaign.tiers,i)===null?'بر اساس تعداد فروش':money(payoutPerTier(campaign.tiers,i))}</td></tr>`}).join('')}</tbody></table></div></div>`;
    $('#mainContent').onclick=()=>{};
  }

  // Navigation and page-level routing
  document.addEventListener('click',e=>{
    const gateRole=e.target.closest('[data-enter-role]');if(gateRole){enterRole(gateRole.dataset.enterRole);return;}
    const nav=e.target.closest('[data-page-nav]');if(nav){const p=nav.dataset.pageNav;if(appRole==='manager'){if(p==='editor')editingCampaignId=null;renderManagerPage(p);}else if(p==='agent')renderBrokerPage();else if(p==='agent-rules')renderBrokerRules();return;}
    const goto=e.target.closest('[data-go-page]');if(goto){if(appRole==='manager'){if(goto.dataset.goPage==='editor')editingCampaignId=null;renderManagerPage(goto.dataset.goPage);}else if(appRole==='broker'){if(goto.dataset.goPage==='agent')renderBrokerPage();else if(goto.dataset.goPage==='agent-rules')renderBrokerRules();}return;}
  });

  // Reports use a separate event hookup after render; manager page event binding handles all other routes.
  const originalRenderManagerPage=renderManagerPage;
  // Wrap renderer to keep nav role/status updated consistently.
  // The function itself is already hoisted; this wrapper is attached to the global navigation path only.

  function bootSplash(){
    const title=$('#splashTitle'),sub=$('#splashSub'),credit=$('#splashCredit');
    window.setTimeout(()=>{title.classList.add('revealed');sub.classList.add('revealed');credit.classList.add('revealed');},5000);
    window.setTimeout(()=>{$('#splash').classList.add('fade-out');window.setTimeout(()=>{$('#splash').classList.add('hidden');$('#roleGate').classList.remove('hidden');maybeUpdateServiceWorker();},650);},6250);
  }
  // Connect dynamic role views and PWA installation.
  bootSplash();
  maybeUpdateServiceWorker();
})();
