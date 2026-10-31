/* 点亮你的书本 —— 交互逻辑 */

(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const AVATARS = ['🧒', '👧', '🐻', '🐰', '🦊', '🐼', '🦄', '🐯'];
  const AGE_GROUPS = ['7-8岁', '9-10岁', '11岁以上'];
  const DEFAULT_AGE = '7-8岁';
  const BOOK_COLORS = ['#ff8a3d', '#ff7aa2', '#a78bfa', '#38bdf8', '#43c97a', '#ffb703', '#ef6c8f', '#7c8cf0', '#22c55e', '#f97316'];
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  const state = {
    children: [],
    activeChildId: localStorage.getItem('activeChildId') || null,
    books: [],
    pendingCover: null,
    pendingCoverUrl: null,
    coverUrls: [],
    detailBookId: null,
    detailCoverUrl: null,
    kidAvatar: AVATARS[0],
    kidAge: DEFAULT_AGE,
    editingKidId: null,
    firstKid: false,
    saving: false
  };

  /* ==================== 通用小工具 ==================== */

  function newId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function todayStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function formatDate(value) {
    if (!value) return '没记日期';
    const parts = value.split('-').map(Number);
    if (parts.length !== 3 || !parts[0]) return '没记日期';
    const now = new Date();
    if (parts[0] === now.getFullYear()) {
      return parts[1] + '月' + parts[2] + '日';
    }
    return parts[0] + '年' + parts[1] + '月' + parts[2] + '日';
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // 根据书名生成稳定的颜色，用于没有封面的书脊
  function colorFor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return BOOK_COLORS[h % BOOK_COLORS.length];
  }

  function activeChild() {
    return state.children.find(function (c) { return c.id === state.activeChildId; }) || null;
  }

  function show() {
    for (let i = 0; i < arguments.length; i++) $(arguments[i]).hidden = false;
  }

  function hide() {
    for (let i = 0; i < arguments.length; i++) $(arguments[i]).hidden = true;
  }

  /* ==================== 数据读取 ==================== */

  async function reloadAll() {
    state.children = await DB.getAllChildren();
    const stillExists = state.children.some(function (c) { return c.id === state.activeChildId; });
    if (!stillExists) {
      state.activeChildId = state.children.length ? state.children[0].id : null;
    }
    localStorage.setItem('activeChildId', state.activeChildId || '');
    await loadBooks();
    renderKids();
    renderStats();
    renderShelf();
  }

  async function loadBooks() {
    if (!state.activeChildId) {
      state.books = [];
      return;
    }
    state.books = await DB.getBooksByChild(state.activeChildId);
    state.books.sort(function (a, b) {
      const fa = a.finishedAt || '';
      const fb = b.finishedAt || '';
      if (fa !== fb) return fb.localeCompare(fa);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  /* ==================== 渲染 ==================== */

  function renderKids() {
    const list = $('kidList');
    list.innerHTML = '';
    state.children.forEach(function (child) {
      const chip = document.createElement('div');
      chip.className = 'kid-chip' + (child.id === state.activeChildId ? ' active' : '');

      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'kid-switch';

      const avatar = document.createElement('span');
      avatar.className = 'kid-avatar';
      avatar.textContent = child.avatar || '🧒';

      const name = document.createElement('span');
      name.className = 'kid-name';
      name.textContent = child.name;

      switchBtn.appendChild(avatar);
      switchBtn.appendChild(name);
      switchBtn.addEventListener('click', async function () {
        if (child.id === state.activeChildId) return;
        state.activeChildId = child.id;
        localStorage.setItem('activeChildId', child.id);
        renderKids();
        await loadBooks();
        renderStats();
        renderShelf();
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'kid-edit';
      editBtn.setAttribute('aria-label', '编辑小朋友');
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', function () {
        openKidDialog(false, child.id);
      });

      chip.appendChild(switchBtn);
      chip.appendChild(editBtn);
      list.appendChild(chip);
    });
  }

  function renderStats() {
    $('statTotal').textContent = state.books.length;
    const month = todayStr().slice(0, 7);
    const monthCount = state.books.filter(function (b) {
      return String(b.finishedAt || '').startsWith(month);
    }).length;
    $('statMonth').textContent = monthCount;
  }

  function revokeCoverUrls() {
    state.coverUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    state.coverUrls = [];
  }

  function renderShelf() {
    const shelf = $('shelf');
    shelf.innerHTML = '';
    revokeCoverUrls();
    $('shelfExtra').textContent = state.books.length ? '共 ' + state.books.length + ' 本' : '';

    if (!state.books.length) {
      const empty = document.createElement('div');
      empty.className = 'shelf-empty';

      const emoji = document.createElement('div');
      emoji.className = 'empty-emoji';
      emoji.textContent = '📚';

      const text = document.createElement('p');
      text.innerHTML = '书架还是空的<br><span>读完一本书，就来点亮它吧！</span>';

      empty.appendChild(emoji);
      empty.appendChild(text);
      shelf.appendChild(empty);
      return;
    }

    state.books.forEach(function (book) {
      const hasCover = !!book.cover;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'book-card' + (hasCover ? '' : ' no-cover');
      if (!hasCover) {
        card.style.setProperty('--book-color', colorFor(book.title));
      }

      const inner = document.createElement('div');
      inner.className = 'book-inner';

      if (hasCover) {
        const url = URL.createObjectURL(book.cover);
        state.coverUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = book.title;
        inner.appendChild(img);

        const title = document.createElement('div');
        title.className = 'book-title';
        title.textContent = book.title;
        inner.appendChild(title);
      } else {
        const title = document.createElement('div');
        title.className = 'book-title';
        title.textContent = book.title;
        inner.appendChild(title);
      }

      card.appendChild(inner);
      card.addEventListener('click', function () { openDetail(book); });
      shelf.appendChild(card);
    });
  }

  /* ==================== 书本详情 ==================== */

  function openDetail(book) {
    state.detailBookId = book.id;
    $('detailTitle').textContent = book.title;

    $('detailAuthor').textContent = book.author ? '作者：' + book.author : '';
    $('detailAuthor').hidden = !book.author;
    $('detailDate').textContent = '读完于 ' + formatDate(book.finishedAt);

    const box = $('detailCover');
    box.innerHTML = '';
    if (state.detailCoverUrl) {
      URL.revokeObjectURL(state.detailCoverUrl);
      state.detailCoverUrl = null;
    }
    if (book.cover) {
      state.detailCoverUrl = URL.createObjectURL(book.cover);
      const img = document.createElement('img');
      img.src = state.detailCoverUrl;
      img.alt = book.title;
      box.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.textContent = '📖';
      box.appendChild(placeholder);
    }

    if (book.review) {
      $('detailReview').textContent = book.review;
      $('detailReviewWrap').hidden = false;
    } else {
      $('detailReviewWrap').hidden = true;
    }

    show('detailBackdrop', 'detailSheet');
  }

  function closeDetail() {
    hide('detailBackdrop', 'detailSheet');
    state.detailBookId = null;
    if (state.detailCoverUrl) {
      URL.revokeObjectURL(state.detailCoverUrl);
      state.detailCoverUrl = null;
    }
    $('detailCover').innerHTML = '';
  }

  async function deleteDetailBook() {
    const book = state.books.find(function (b) { return b.id === state.detailBookId; });
    if (!book) {
      closeDetail();
      return;
    }
    if (!window.confirm('要删除《' + book.title + '》这条记录吗？')) return;
    await DB.deleteBook(book.id);
    closeDetail();
    await loadBooks();
    renderStats();
    renderShelf();
    toast('已经删掉啦');
  }

  /* ==================== 录入表单 ==================== */

  function openForm() {
    if (!state.children.length) {
      openKidDialog(true);
      return;
    }
    $('fTitle').value = '';
    $('fAuthor').value = '';
    $('fReview').value = '';
    $('fDate').value = todayStr();
    clearPendingCover();
    show('formBackdrop', 'formSheet');
  }

  function closeForm() {
    stopMic();
    hide('formBackdrop', 'formSheet');
    clearPendingCover();
  }

  function clearPendingCover() {
    if (state.pendingCoverUrl) {
      URL.revokeObjectURL(state.pendingCoverUrl);
      state.pendingCoverUrl = null;
    }
    state.pendingCover = null;
    $('coverPreview').innerHTML = '📷';
    $('coverClear').hidden = true;
  }

  function setPendingCover(blob) {
    if (state.pendingCoverUrl) URL.revokeObjectURL(state.pendingCoverUrl);
    state.pendingCover = blob;
    state.pendingCoverUrl = URL.createObjectURL(blob);
    $('coverPreview').innerHTML = '';
    const img = document.createElement('img');
    img.src = state.pendingCoverUrl;
    img.alt = '书本封面';
    $('coverPreview').appendChild(img);
    $('coverClear').hidden = false;
  }

  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        try {
          const longest = Math.max(img.naturalWidth, img.naturalHeight);
          const scale = Math.min(1, maxSide / longest);
          const w = Math.round(img.naturalWidth * scale);
          const h = Math.round(img.naturalHeight * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (blob) resolve(blob);
            else reject(new Error('图片压缩失败'));
          }, 'image/jpeg', quality);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片读取失败'));
      };
      img.src = url;
    });
  }

  async function handleCoverFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const blob = await compressImage(file, 1200, 0.82);
      setPendingCover(blob);
    } catch (err) {
      console.error(err);
      toast('这张照片读不出来，换一张试试');
    }
  }

  async function saveBook() {
    if (state.saving) return;
    const title = $('fTitle').value.trim();
    if (!title) {
      toast('先写下书名吧');
      $('fTitle').focus();
      return;
    }
    if (!state.activeChildId) {
      openKidDialog(true);
      return;
    }

    state.saving = true;
    $('saveBook').disabled = true;
    try {
      const book = {
        id: newId(),
        childId: state.activeChildId,
        title: title,
        author: $('fAuthor').value.trim(),
        finishedAt: $('fDate').value || todayStr(),
        review: $('fReview').value.trim(),
        cover: state.pendingCover || null,
        createdAt: Date.now()
      };
      await DB.saveBook(book);
      closeForm();
      await loadBooks();
      renderStats();
      renderShelf();
      celebrate(book, state.books.length);
    } catch (err) {
      console.error(err);
      toast('保存失败，再试一次');
    } finally {
      state.saving = false;
      $('saveBook').disabled = false;
    }
  }

  /* ==================== 语音输入 ==================== */
  /*
    iOS Safari 的 webkitSpeechRecognition 很不稳定：即使给了麦克风权限，
    也经常报 not-allowed 或直接挂掉。所以策略是：
      1) 先尝试网页内识别；
      2) 一旦失败（权限 / 网络 / 系统 bug / 超时 / 抛异常 任意一种），
         立刻自动切到「系统键盘听写」——把光标放进输入框，弹出键盘，
         让孩子点键盘下方的麦克风说话。这是 iPad 上 100% 稳定的方案。
  */

  let currentMic = null;
  let micFallbackTimer = null;

  function stopMic() {
    if (micFallbackTimer) {
      clearTimeout(micFallbackTimer);
      micFallbackTimer = null;
    }
    if (!currentMic) return;
    const rec = currentMic.rec;
    const btn = currentMic.btn;
    currentMic = null;
    btn.classList.remove('listening');
    try { rec.abort(); } catch (err) { /* 忽略 */ }
  }

  // 兜底：用 iPad 系统键盘自带的听写（输入法麦克风）
  function keyboardDictation(target) {
    target.focus();
    // 轻提示，告诉孩子键盘上有麦克风
    toast('点键盘下方的麦克风 🎤，对着说就好啦');
  }

  function startMic(btn, target) {
    // 先把光标放进去，这样不管后面识别成功失败，键盘都能弹出来
    target.focus();

    if (!SpeechRecognitionCtor) {
      keyboardDictation(target);
      return;
    }
    if (currentMic) {
      const prev = currentMic;
      currentMic = null;
      prev.btn.classList.remove('listening');
      try { prev.rec.abort(); } catch (err) { /* 忽略 */ }
    }

    const base = target.value;
    let finalText = '';
    let gotResult = false;
    const rec = new SpeechRecognitionCtor();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    currentMic = { rec: rec, btn: btn };
    btn.classList.add('listening');

    // 安全网：3 秒还没出任何结果，说明网页识别大概率挂了，自动切到键盘听写
    micFallbackTimer = setTimeout(function () {
      if (!gotResult) {
        stopMic();
        target.value = base + finalText;
        keyboardDictation(target);
      }
    }, 3000);

    rec.onresult = function (event) {
      gotResult = true;
      if (micFallbackTimer) {
        clearTimeout(micFallbackTimer);
        micFallbackTimer = null;
      }
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      target.value = base + finalText + interim;
    };

    rec.onerror = function () {
      // 任何错误都不再让用户去设置里折腾，直接切到键盘听写
      if (micFallbackTimer) {
        clearTimeout(micFallbackTimer);
        micFallbackTimer = null;
      }
      stopMic();
      target.value = base + finalText;
      keyboardDictation(target);
    };

    rec.onend = function () {
      btn.classList.remove('listening');
      if (currentMic && currentMic.rec === rec) currentMic = null;
      if (micFallbackTimer) {
        clearTimeout(micFallbackTimer);
        micFallbackTimer = null;
      }
      target.value = base + finalText;
    };

    try {
      rec.start();
    } catch (err) {
      if (micFallbackTimer) {
        clearTimeout(micFallbackTimer);
        micFallbackTimer = null;
      }
      stopMic();
      keyboardDictation(target);
    }
  }

  function setupMics() {
    document.querySelectorAll('.mic-btn').forEach(function (btn) {
      const target = $(btn.dataset.target);
      if (!target) return;
      btn.addEventListener('click', function () {
        if (currentMic && currentMic.btn === btn) {
          stopMic();
          return;
        }
        startMic(btn, target);
      });
    });
  }

  /* ==================== 庆祝夸奖 ==================== */

  const MILESTONES = {
    1: '这是你的第一本书！{name} 和书的故事，从今天正式开始啦！',
    3: '已经读完 3 本书！{name} 的小书架开始有模有样了！',
    5: '5 本！{name} 的小书架亮起了第一排小灯，太酷了！',
    10: '10 本！{name} 是货真价实的小书虫，整座书架都在为你鼓掌！',
    20: '20 本！{name} 读过的故事连起来，可以绕地球一圈啦！',
    50: '50 本！{name} 已经是阅读小达人，书里的世界都认识你了！',
    100: '100 本！{name} 创造了属于自己的阅读奇迹，太了不起了！'
  };

  const PRAISES = [
    '哇！{name} 又读完一本书啦！这是第 {n} 本，你的小书架正在闪闪发光！🌟',
    '太厉害了 {name}！第 {n} 本书被你点亮，书里的故事都记住你啦！📚',
    '{name}，你真是个小书虫！已经读完 {n} 本书，每一本都变成了你脑袋里的小星星！✨',
    '叮！第 {n} 本书点亮成功！{name} 的阅读能量又满格了，继续加油！⚡',
    '不得了啦！{name} 读完第 {n} 本书，连书里的主人公都想给你鼓掌！👏',
    '{name} 又一次完成了挑战！第 {n} 本书收入书架，你现在是阅读小达人！🏅'
  ];

  function praiseText(name, total) {
    let text = MILESTONES[total] ? MILESTONES[total] + ' ' : '';
    text += pick(PRAISES);
    return text.replace(/\{name\}/g, name).replace(/\{n\}/g, String(total));
  }

  function makeConfetti() {
    const box = $('confetti');
    box.innerHTML = '';
    const colors = ['#ff8a3d', '#ffb703', '#ff7aa2', '#38bdf8', '#43c97a', '#a78bfa'];
    for (let i = 0; i < 56; i++) {
      const piece = document.createElement('i');
      piece.className = 'confetti-piece';
      piece.style.left = (Math.random() * 100) + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.width = (6 + Math.random() * 6) + 'px';
      piece.style.height = (10 + Math.random() * 10) + 'px';
      piece.style.animationDelay = (Math.random() * 0.9) + 's';
      piece.style.animationDuration = (1.8 + Math.random() * 1.4) + 's';
      box.appendChild(piece);
    }
  }

  function celebrate(book, total) {
    const child = activeChild();
    const name = child ? child.name : '小书虫';
    $('celebrateCount').textContent = '第 ' + total + ' 本！';
    $('celebrateText').textContent = praiseText(name, total);
    $('celebrateBook').textContent = '《' + book.title + '》';
    makeConfetti();
    $('celebration').hidden = false;
  }

  function closeCelebration() {
    $('celebration').hidden = true;
    $('confetti').innerHTML = '';
  }

  /* ==================== 小朋友档案 ==================== */

  function openKidDialog(isFirst, editingId) {
    state.firstKid = isFirst;
    state.editingKidId = editingId || null;
    state.kidAvatar = AVATARS[0];
    state.kidAge = DEFAULT_AGE;
    $('kidName').value = '';
    $('kidDelete').hidden = true;

    if (editingId) {
      const child = state.children.find(function (c) { return c.id === editingId; });
      if (child) {
        $('kidName').value = child.name;
        state.kidAvatar = child.avatar || AVATARS[0];
        state.kidAge = child.ageGroup || DEFAULT_AGE;
        $('kidDelete').hidden = false;
      }
      $('kidDialogTitle').textContent = '编辑小朋友';
    } else {
      $('kidDialogTitle').textContent = isFirst ? '谁在读书呀？' : '再添加一位小朋友';
    }

    $('kidCancel').hidden = isFirst;
    renderAgeGrid();
    renderAvatarGrid();
    show('kidBackdrop', 'kidDialog');
    setTimeout(function () { $('kidName').focus(); }, 300);
  }

  function closeKidDialog() {
    if (state.firstKid) return;
    hide('kidBackdrop', 'kidDialog');
  }

  function renderAgeGrid() {
    const grid = $('ageGrid');
    grid.innerHTML = '';
    AGE_GROUPS.forEach(function (age) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'age-btn' + (age === state.kidAge ? ' active' : '');
      btn.textContent = age;
      btn.addEventListener('click', function () {
        state.kidAge = age;
        renderAgeGrid();
      });
      grid.appendChild(btn);
    });
  }

  function renderAvatarGrid() {
    const grid = $('avatarGrid');
    grid.innerHTML = '';
    AVATARS.forEach(function (avatar) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-btn' + (avatar === state.kidAvatar ? ' active' : '');
      btn.textContent = avatar;
      btn.addEventListener('click', function () {
        state.kidAvatar = avatar;
        renderAvatarGrid();
      });
      grid.appendChild(btn);
    });
  }

  async function saveKid() {
    const name = $('kidName').value.trim();
    if (!name) {
      toast('先给小朋友起个名字吧');
      $('kidName').focus();
      return;
    }

    if (state.editingKidId) {
      const child = state.children.find(function (c) { return c.id === state.editingKidId; });
      if (child) {
        child.name = name;
        child.avatar = state.kidAvatar;
        child.ageGroup = state.kidAge;
        await DB.saveChild(child);
        hide('kidBackdrop', 'kidDialog');
        await reloadAll();
        toast('已更新 ' + name + ' 的档案');
        return;
      }
    }

    const child = {
      id: newId(),
      name: name,
      avatar: state.kidAvatar,
      ageGroup: state.kidAge,
      createdAt: Date.now()
    };
    await DB.saveChild(child);
    state.firstKid = false;
    state.activeChildId = child.id;
    localStorage.setItem('activeChildId', child.id);
    hide('kidBackdrop', 'kidDialog');
    await reloadAll();
    toast('你好，' + name + '！开始点亮第一本书吧');
  }

  async function deleteKid() {
    if (!state.editingKidId) return;
    const child = state.children.find(function (c) { return c.id === state.editingKidId; });
    if (!child) return;
    if (!window.confirm('删除 ' + child.name + ' 会同时删掉 TA 的所有读书记录，确定吗？')) return;

    const books = await DB.getBooksByChild(child.id);
    for (const book of books) {
      await DB.deleteBook(book.id);
    }
    await DB.deleteChild(child.id);
    if (state.activeChildId === child.id) {
      state.activeChildId = null;
    }
    hide('kidBackdrop', 'kidDialog');
    await reloadAll();
    if (!state.children.length) {
      openKidDialog(true);
    } else {
      toast('已删除 ' + child.name);
    }
  }

  /* ==================== 备份与恢复 ==================== */

  function openBackupDialog() {
    show('backupBackdrop', 'backupDialog');
  }

  function closeBackupDialog() {
    hide('backupBackdrop', 'backupDialog');
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  async function dataURLToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return response.blob();
  }

  async function exportBackup() {
    try {
      const children = await DB.getAllChildren();
      const books = await DB.getAllBooks();
      const booksOut = [];
      for (const book of books) {
        const copy = {
          id: book.id,
          childId: book.childId,
          title: book.title,
          author: book.author || '',
          finishedAt: book.finishedAt || '',
          review: book.review || '',
          createdAt: book.createdAt || 0,
          cover: null
        };
        if (book.cover) {
          copy.cover = await blobToDataURL(book.cover);
        }
        booksOut.push(copy);
      }

      const payload = {
        app: '点亮你的书本',
        version: 1,
        exportedAt: new Date().toISOString(),
        children: children,
        books: booksOut
      };

      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '点亮书本备份-' + todayStr() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast('备份文件已生成，可以存进「文件」App 或发给自己');
    } catch (err) {
      console.error(err);
      toast('导出失败，再试一次');
    }
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.children) || !Array.isArray(data.books)) {
        toast('这个文件不是「点亮书本」的备份');
        return;
      }
      if (!window.confirm('导入会用备份里的内容替换这台 iPad 上的现有记录，确定吗？')) return;

      await DB.clearAll();

      for (const child of data.children) {
        if (!child || !child.id || !child.name) continue;
        await DB.saveChild({
          id: child.id,
          name: child.name,
          avatar: child.avatar || '🧒',
          ageGroup: child.ageGroup || DEFAULT_AGE,
          createdAt: child.createdAt || Date.now()
        });
      }

      for (const book of data.books) {
        if (!book || !book.id || !book.childId || !book.title) continue;
        let cover = null;
        if (book.cover) {
          try { cover = await dataURLToBlob(book.cover); } catch (err) { cover = null; }
        }
        await DB.saveBook({
          id: book.id,
          childId: book.childId,
          title: book.title,
          author: book.author || '',
          finishedAt: book.finishedAt || '',
          review: book.review || '',
          cover: cover,
          createdAt: book.createdAt || 0
        });
      }

      await reloadAll();
      closeBackupDialog();
      toast('恢复完成！共 ' + data.books.length + ' 本书');
    } catch (err) {
      console.error(err);
      toast('导入失败：文件可能已损坏');
    }
  }

  /* ==================== 事件绑定 ==================== */

  function bindEvents() {
    $('addBookBtn').addEventListener('click', openForm);
    $('formClose').addEventListener('click', closeForm);
    $('saveBook').addEventListener('click', saveBook);

    $('cameraBtn').addEventListener('click', function () { $('cameraInput').click(); });
    $('albumBtn').addEventListener('click', function () { $('albumInput').click(); });
    $('cameraInput').addEventListener('change', handleCoverFile);
    $('albumInput').addEventListener('change', handleCoverFile);
    $('coverClear').addEventListener('click', clearPendingCover);

    $('backupBtn').addEventListener('click', openBackupDialog);
    $('backupClose').addEventListener('click', closeBackupDialog);
    $('backupBackdrop').addEventListener('click', closeBackupDialog);
    $('exportBtn').addEventListener('click', exportBackup);
    $('importBtn').addEventListener('click', function () { $('importInput').click(); });
    $('importInput').addEventListener('change', async function (event) {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      await importBackup(file);
    });

    $('addKidBtn').addEventListener('click', function () { openKidDialog(false); });
    $('kidSave').addEventListener('click', saveKid);
    $('kidCancel').addEventListener('click', closeKidDialog);
    $('kidBackdrop').addEventListener('click', closeKidDialog);
    $('kidDelete').addEventListener('click', deleteKid);

    $('detailClose').addEventListener('click', closeDetail);
    $('detailBackdrop').addEventListener('click', closeDetail);
    $('deleteBook').addEventListener('click', deleteDetailBook);

    $('celebrateClose').addEventListener('click', closeCelebration);

    setupMics();
  }

  /* ==================== 启动 ==================== */

  async function init() {
    bindEvents();
    try {
      await reloadAll();
    } catch (err) {
      console.error(err);
      toast('本地数据打不开，请用 Safari 或 Chrome 打开这个页面');
      return;
    }
    if (!state.children.length) {
      openKidDialog(true);
    }
  }

  init();
})();
