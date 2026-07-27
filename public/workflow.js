(() => {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[char]));
  const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));
  const finished = (stage) => stage?.status === 'success' || stage?.status === 'ready';

  function duration(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  function globalProgress(workflow) {
    if (workflow.status === 'ready') return 100;
    if (Number.isFinite(Number(workflow.percent)) && Number(workflow.percent) > 0) return clamp(workflow.percent);
    const stages = Array.isArray(workflow.stages) ? workflow.stages : [];
    const complete = stages.filter(finished).length;
    const active = stages.find((stage) => stage.status === 'running');
    const activeShare = active?.progress?.total ? clamp((active.progress.completed / active.progress.total) * 100) / 100 : 0.22;
    return stages.length ? clamp(((complete + activeShare) / stages.length) * 100) : 0;
  }

  function stageIcon(stage) {
    if (finished(stage)) return '<span class="build-check" aria-hidden="true">✓</span>';
    if (stage.status === 'failed') return '<span class="build-check failed" aria-hidden="true">!</span>';
    if (stage.status === 'running') return '<span class="build-spinner" aria-hidden="true"></span>';
    return '<span class="build-dot" aria-hidden="true"></span>';
  }

  function visibleStages(stages) {
    const activeIndex = stages.findIndex((stage) => stage.status === 'running' || stage.status === 'failed');
    if (activeIndex >= 0) return stages.slice(Math.max(0, activeIndex - 2), Math.min(stages.length, activeIndex + 3));
    return stages.slice(Math.max(0, stages.length - 5));
  }

  function activityFeed(activities, workflow) {
    const safe = (activities || []).filter((item) => item && ['running','success','failed'].includes(item.status)).slice(0, 3);
    if (safe.length) {
      return `<div class="build-live-log" aria-label="Recent analysis operations">${safe.map((item) => `<div class="build-log-row ${escape(item.status)}"><span class="build-log-mark">${item.status === 'success' ? '✓' : item.status === 'failed' ? '!' : '›'}</span><div><strong>${escape(item.title || 'Campaign read')}</strong><span>${escape(item.detail || '')}</span></div>${item.duration_ms ? `<time>${escape(duration(item.duration_ms))}</time>` : ''}</div>`).join('')}</div>`;
    }
    const stages = visibleStages(Array.isArray(workflow.stages) ? workflow.stages : []).slice(0, 3);
    return `<div class="build-live-log" aria-label="Analysis stages">${stages.map((stage) => `<div class="build-log-row ${escape(stage.status)}">${stageIcon(stage)}<div><strong>${escape(stage.label)}</strong><span>${escape(stage.detail || stage.caption || '')}</span></div>${stage.duration_ms ? `<time>${escape(duration(stage.duration_ms))}</time>` : ''}</div>`).join('')}</div>`;
  }

  function skeleton() {
    return `<div class="report-ghost" aria-hidden="true">
      <div class="ghost-header"><div><i class="ghost-line wide"></i><i class="ghost-line medium"></i></div><i class="ghost-pill"></i></div>
      <div class="ghost-kpis">${[1,2,3,4].map(() => '<div class="ghost-kpi"><i class="ghost-line short"></i><i class="ghost-line value"></i><i class="ghost-line tiny"></i></div>').join('')}</div>
      <div class="ghost-grid"><div class="ghost-chart"><i class="ghost-line medium"></i><div class="ghost-bars">${[1,2,3,4,5,6,7,8].map((index) => `<i class="ghost-bar-${index}"></i>`).join('')}</div></div><div class="ghost-table"><i class="ghost-line medium"></i>${[1,2,3,4,5].map(() => '<div><i></i><i></i><i></i></div>').join('')}</div></div>
    </div>`;
  }

  function render(root, workflow, options = {}) {
    if (!root) return;
    if (!workflow) { root.hidden = true; root.innerHTML = ''; root._workflowSignature = ''; return; }
    root.hidden = false;

    const status = workflow.status || 'queued';
    const stages = Array.isArray(workflow.stages) ? workflow.stages : [];
    const current = stages.find((stage) => stage.id === workflow.current_stage) || stages.find((stage) => stage.status === 'running' || stage.status === 'failed') || stages[stages.length - 1] || {};
    const stageProgress = current.progress?.total ? clamp((current.progress.completed / current.progress.total) * 100) : null;
    const overall = globalProgress(workflow);
    const ready = status === 'ready';
    const failed = status === 'failed';
    const queued = status === 'queued';
    const headline = ready ? 'Your campaign report is ready' : failed ? 'The report build needs attention' : queued ? 'Queued for analysis' : current.label || 'Building your campaign report';
    const detail = ready ? 'The evidence-backed report passed validation and is ready to review.' : failed ? workflow.summary || current.detail || 'The analysis stopped before the report was completed.' : queued ? workflow.summary || 'The read-only workflow will begin shortly.' : current.detail || workflow.summary || current.caption || 'Reading campaign evidence.';
    const pill = ready ? 'Report ready' : failed ? 'Build failed' : queued ? 'Waiting to start' : stageProgress === null ? 'Analyzing now' : `${current.progress.completed} of ${current.progress.total} complete`;
    const eyebrow = options.preview ? 'Interactive design preview' : 'Live campaign analysis';
    const signature = JSON.stringify({
      status,
      current_stage: workflow.current_stage,
      summary: workflow.summary,
      percent: workflow.percent,
      stages: stages.map((stage) => [stage.id, stage.status, stage.detail, stage.progress?.completed, stage.progress?.total, stage.duration_ms]),
      activities: (options.activities || []).slice(0, 3).map((item) => [item.call_id, item.status, item.title, item.detail, item.duration_ms]),
      preview: Boolean(options.preview)
    });
    if (root._workflowSignature === signature) return;
    const updating = Boolean(root._workflowSignature);
    root._workflowSignature = signature;

    root.dataset.status = status;
    root.classList.toggle('workflow-preview-host', Boolean(options.preview));
    if (ready && !options.preview) {
      let strip = root.querySelector(':scope > .workflow-ready-strip');
      if (!strip) {
        root.innerHTML = '<div class="workflow-ready-strip"><span class="ready-strip-check" aria-hidden="true">✓</span><div><strong>Report ready</strong><span></span></div><span class="ready-strip-state">Ready to review</span></div>';
        strip = root.querySelector(':scope > .workflow-ready-strip');
      }
      strip.querySelector(':scope > div > span').textContent = `${stages.filter(finished).length || stages.length} verified stages complete · validation passed`;
      return;
    }
    let build = root.querySelector(':scope > .campaign-build');
    if (!build) {
      root.innerHTML = `<div class="campaign-build">
      ${skeleton()}
      <div class="build-shimmer" aria-hidden="true"></div>
      <div class="build-card-layer">
        <article class="build-card">
          <div class="build-mark"><img src="/campaign-reports-icon.png" alt=""><span aria-hidden="true"></span></div>
          <p class="build-eyebrow"></p>
          <h2></h2>
          <p class="build-detail"></p>
          <div class="build-status-pill"><i></i><span></span></div>
          <progress class="build-progress-native" max="100"></progress>
          <div class="build-progress-copy"><span></span><strong></strong></div>
          <div class="build-log-host"></div>
          <p class="build-preview-note">Preview data only · production updates come from real API calls</p>
        </article>
      </div>
    </div>`;
      build = root.querySelector(':scope > .campaign-build');
    }

    build.className = `campaign-build ${status}`;
    build.querySelector('.build-shimmer').hidden = ready || failed || queued;
    const card = build.querySelector('.build-card');
    card.className = `build-card ${status}`;
    card.querySelector('.build-eyebrow').textContent = eyebrow;
    card.querySelector('h2').textContent = headline;
    card.querySelector('.build-detail').textContent = detail;
    const statusPill = card.querySelector('.build-status-pill');
    statusPill.className = `build-status-pill ${status}`;
    statusPill.querySelector('span').textContent = pill;
    const progress = card.querySelector('.build-progress-native');
    const progressCopy = card.querySelector('.build-progress-copy');
    progress.hidden = failed || queued;
    progressCopy.hidden = failed || queued;
    if (!failed && !queued) {
      const value = stageProgress ?? overall;
      progress.value = value;
      progress.setAttribute('aria-label', `${Math.round(value)} percent complete`);
      progressCopy.querySelector('span').textContent = stageProgress === null ? `${Math.round(overall)}% of workflow complete` : current.label || 'Current stage';
      progressCopy.querySelector('strong').textContent = `${Math.round(stageProgress ?? overall)}%`;
    }
    card.querySelector('.build-log-host').innerHTML = activityFeed(options.activities, workflow);
    card.querySelector('.build-preview-note').hidden = !options.preview;
  }

  window.WorkflowUI = { render };
})();
