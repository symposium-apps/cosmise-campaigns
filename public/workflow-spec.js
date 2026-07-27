(() => {
  const definitions = [
    ['scope','Confirming campaign scope','Verifying Maiden Home and reporting sources.'],
    ['models','Loading attribution models','Reading the live Campaigns model manifest.'],
    ['performance','Comparing campaign performance','Running the same query across attribution models.'],
    ['trend','Reading daily trends','Checking the shape of performance through April.'],
    ['mapping','Checking campaign mappings','Reviewing mapping coverage without making changes.'],
    ['diagnostics','Checking tracking quality','Reviewing identity and revenue quality.'],
    ['writing','Writing the report','Turning verified evidence into clear findings.'],
    ['validation','Validating the report','Checking tables, chart, structure, and safety.'],
    ['complete','Report ready','The validated report is ready to review.']
  ];

  const moments = [
    { id:'scope', detail:'Confirming Maiden Home and connected reporting sources' },
    { id:'models', detail:'Loaded 19 available attribution models' },
    { id:'performance', detail:'Reading first click client — model 4 of 19', progress:{ completed:3,total:19 } },
    { id:'performance', detail:'Reading linear client — model 11 of 19', progress:{ completed:10,total:19 } },
    { id:'mapping', detail:'Reviewing mapping coverage and exact candidates' },
    { id:'diagnostics', detail:'Checking identity and revenue quality' },
    { id:'writing', detail:'Writing findings, chart, and recommended actions' },
    { id:'validation', detail:'Checking report structure, charts, and safety' }
  ];

  let index = 2;
  let timer = null;

  function workflowFor(momentIndex, terminal) {
    if (terminal === 'ready') {
      return { status:'ready', current_stage:null, summary:'Report ready', percent:100, stages:definitions.map(([id,label,caption]) => ({ id,label,caption,status:'success',detail:id==='complete'?'Report ready to review':`${label.replace(/ing\b/,'ed')} complete`,duration_ms:id==='performance'?381399:842,progress:id==='performance'?{completed:19,total:19}:null })) };
    }
    const moment = moments[Math.max(0, Math.min(moments.length - 1, momentIndex))];
    if (terminal === 'failed') {
      return { status:'failed', current_stage:'mapping', summary:'Mapping diagnostics could not be loaded. Retry is safe and no data was changed.', stages:definitions.map(([id,label,caption], stageIndex) => ({ id,label,caption,status:stageIndex<4?'success':id==='mapping'?'failed':'pending',detail:id==='mapping'?'Mapping diagnostics could not be loaded. Retry is safe.':caption,duration_ms:stageIndex<4?842:null })) };
    }
    const activeIndex = definitions.findIndex(([id]) => id === moment.id);
    const stages = definitions.map(([id,label,caption], stageIndex) => ({
      id,label,caption,
      status:stageIndex < activeIndex ? 'success' : stageIndex === activeIndex ? 'running' : 'pending',
      detail:stageIndex === activeIndex ? moment.detail : stageIndex < activeIndex ? `${label} complete` : caption,
      duration_ms:stageIndex < activeIndex ? (id === 'performance' ? 381399 : 842) : null,
      progress:stageIndex === activeIndex ? moment.progress || null : id === 'performance' && stageIndex < activeIndex ? {completed:19,total:19} : null
    }));
    return { status:'running', current_stage:moment.id, summary:moment.detail, stages };
  }

  function activitiesFor(workflow) {
    const current = workflow.stages.find((stage) => stage.status === 'running' || stage.status === 'failed');
    const complete = workflow.stages.filter((stage) => stage.status === 'success').slice(-3).reverse();
    return [
      ...(current ? [{ status:current.status, title:current.label, detail:current.detail, duration_ms:null }] : []),
      ...complete.map((stage) => ({ status:'success', title:stage.label, detail:stage.detail, duration_ms:stage.duration_ms }))
    ];
  }

  function render(terminal) {
    const workflow = workflowFor(index, terminal);
    window.WorkflowUI.render(document.querySelector('#workflow-preview'), workflow, { preview:true, activities:activitiesFor(workflow) });
    const status = document.querySelector('#demo-status');
    if (terminal === 'ready') status.innerHTML = '<strong>Ready state</strong> after validation passes';
    else if (terminal === 'failed') status.innerHTML = '<strong>Failure state</strong> with a safe retry message';
    else status.innerHTML = `<strong>Building</strong> · sample event ${index + 1} of ${moments.length}`;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    document.querySelector('[data-action="play"]')?.classList.remove('active');
  }

  function play() {
    stop();
    index = 0;
    render();
    document.querySelector('[data-action="play"]')?.classList.add('active');
    timer = setInterval(() => {
      if (index < moments.length - 1) { index += 1; render(); return; }
      stop();
      render('ready');
    }, 1900);
  }

  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'play') return play();
    stop();
    if (action === 'next') { index = (index + 1) % moments.length; render(); }
    if (action === 'ready') render('ready');
    if (action === 'failed') render('failed');
  }));

  play();
})();
