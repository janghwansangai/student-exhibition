/* =====================================================================
   전시관 로직
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- 유틸 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // 이름 가운데 글자 가리기. "강훈(부장)" 같은 괄호 표기는 제거.
  function maskName(raw) {
    let n = String(raw || "").replace(/\(.*?\)/g, "").trim();
    if (!n) return "익명";
    const ch = Array.from(n);
    if (ch.length === 1) return ch[0];
    if (ch.length === 2) return ch[0] + "*";
    return ch[0] + "*".repeat(ch.length - 2) + ch[ch.length - 1];
  }

  // 안전한 문서 키 (Firestore/로컬스토리지 공용)
  function appKey(name, title) {
    const base = (title && title.trim()) || (name && name.trim()) || "app";
    return base.replace(/[\/#\.\[\]\$]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  // 선생님 별점 문자열에서 채워진 별(★) 개수
  function countTeacherStars(s) {
    const m = String(s || "").match(/★/g);
    return m ? m.length : 0;
  }

  function isHttpUrl(s) {
    return /^https?:\/\//i.test(String(s || "").trim());
  }

  /* ---------- CSV 파서 (따옴표/줄바꿈/콤마 처리) ---------- */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", i = 0, inQ = false;
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    row.push(field); rows.push(row);
    return rows;
  }

  /* ---------- 카테고리 아이콘/색 (제목·설명 키워드) ---------- */
  const ICON_RULES = [
    [/주식|투자|업스닥|증권/, "ti-chart-line", "#3b6d55"],
    [/채팅|톡|메일|메세지|메시지|소통/, "ti-message-circle", "#3a5a7a"],
    [/영어|단어|링고|어휘|낱말/, "ti-language", "#6a4a7a"],
    [/시험|문제|공부|챌린지|퀴즈|수업|학습|스터디/, "ti-school", "#7a5a34"],
    [/자리|배치|좌석/, "ti-layout-grid", "#4a5a6a"],
    [/뽑기|랜덤|추첨|발표자|번호/, "ti-dice-5", "#7a4a4a"],
    [/영상|편집|사진|카메라|찰칵/, "ti-video", "#5a4a7a"],
    [/질문/, "ti-help-circle", "#4a6a5a"],
    [/과학|steam|융합|발명/, "ti-atom-2", "#356a6a"],
    [/트랜드|트렌드|유행/, "ti-trending-up", "#7a5a5a"],
    [/ai|인공지능|도우미/, "ti-robot", "#4a4a6a"]
  ];
  function pickIcon(title, desc) {
    const hay = (title + " " + desc).toLowerCase();
    for (const [re, icon, color] of ICON_RULES) if (re.test(hay)) return { icon, color };
    return { icon: "ti-app-window", color: "#5a5348" };
  }

  /* =================================================================
     저장소 백엔드 : Firebase 있으면 공유, 없으면 로컬(미리보기)
     ================================================================= */
  const Store = (function () {
    const fb = CONFIG.firebase;
    const useFirebase = fb && fb.apiKey && fb.projectId;
    let db = null;

    if (useFirebase) {
      firebase.initializeApp(fb);
      db = firebase.firestore();
    }

    // 이 브라우저가 이미 좋아요한 앱 (중복 방지)
    const LK = "gallery_liked_v1";
    function likedSet() {
      try { return new Set(JSON.parse(localStorage.getItem(LK) || "[]")); }
      catch (e) { return new Set(); }
    }
    function markLiked(key) {
      const s = likedSet(); s.add(key);
      localStorage.setItem(LK, JSON.stringify([...s]));
    }
    function hasLiked(key) { return likedSet().has(key); }

    /* ----- 로컬 모드 저장 ----- */
    const L = {
      likesKey: "gallery_likes_v1",
      commentsKey: "gallery_comments_v1",
      readAll() { try { return JSON.parse(localStorage.getItem(this.likesKey) || "{}"); } catch (e) { return {}; } },
      writeAll(o) { localStorage.setItem(this.likesKey, JSON.stringify(o)); },
      readComments() { try { return JSON.parse(localStorage.getItem(this.commentsKey) || "{}"); } catch (e) { return {}; } },
      writeComments(o) { localStorage.setItem(this.commentsKey, JSON.stringify(o)); }
    };

    return {
      mode: useFirebase ? "firebase" : "local",
      hasLiked, markLiked,

      // 현재 좋아요 수 (로컬 모드 즉시 갱신용)
      readLocalLikes(key) { return L.readAll()[key] || 0; },

      // 앱별 좋아요 수 실시간 구독. cb(key, count)
      subscribeLikes(keys, cb) {
        if (useFirebase) {
          keys.forEach((key) => {
            db.collection("apps").doc(key).onSnapshot((doc) => {
              cb(key, (doc.exists && doc.data().likes) || 0);
            });
          });
        } else {
          const all = L.readAll();
          keys.forEach((key) => cb(key, all[key] || 0));
        }
      },

      // 좋아요 +1 (중복은 호출 전에 hasLiked로 차단)
      async like(key) {
        if (hasLiked(key)) return false;
        if (useFirebase) {
          const ref = db.collection("apps").doc(key);
          await ref.set(
            { likes: firebase.firestore.FieldValue.increment(1) },
            { merge: true }
          );
        } else {
          const all = L.readAll(); all[key] = (all[key] || 0) + 1; L.writeAll(all);
        }
        markLiked(key);
        return true;
      },

      // 댓글 실시간 구독. cb(list)
      subscribeComments(key, cb) {
        if (useFirebase) {
          return db.collection("apps").doc(key).collection("comments")
            .orderBy("ts", "desc").limit(100)
            .onSnapshot((snap) => {
              const list = [];
              snap.forEach((d) => list.push(d.data()));
              cb(list);
            });
        } else {
          const all = L.readComments();
          cb((all[key] || []).slice().reverse());
          this._localCommentCb = this._localCommentCb || {};
          this._localCommentCb[key] = cb;
          return function () {};
        }
      },

      async addComment(key, nick, text) {
        const clean = {
          nick: String(nick || "익명").slice(0, CONFIG.MAX_NICK_LEN) || "익명",
          text: String(text || "").slice(0, CONFIG.MAX_COMMENT_LEN)
        };
        if (!clean.text.trim()) return;
        if (useFirebase) {
          await db.collection("apps").doc(key).collection("comments").add({
            nick: clean.nick, text: clean.text,
            ts: firebase.firestore.FieldValue.serverTimestamp()
          });
        } else {
          const all = L.readComments();
          all[key] = all[key] || [];
          all[key].push({ nick: clean.nick, text: clean.text, ts: Date.now() });
          L.writeComments(all);
          if (this._localCommentCb && this._localCommentCb[key]) {
            this._localCommentCb[key](all[key].slice().reverse());
          }
        }
      }
    };
  })();

  /* =================================================================
     렌더링
     ================================================================= */
  const gallery = document.getElementById("gallery");
  const statusLine = document.getElementById("statusLine");
  let APPS = [];

  function starsHtml(likes) {
    const filled = Math.min(5, Math.floor(likes / CONFIG.LIKES_PER_STAR));
    let h = "";
    for (let i = 0; i < 5; i++) {
      h += `<i class="ti ti-star${i < filled ? "" : " empty"}" aria-hidden="true"></i>`;
    }
    return `<div class="stars" title="좋아요 ${likes}개">${h}<span class="lk-count">좋아요 ${likes}</span></div>`;
  }

  function render() {
    document.getElementById("galleryTitle").textContent = CONFIG.TITLE;
    document.getElementById("gallerySubtitle").textContent = CONFIG.SUBTITLE;

    gallery.innerHTML = "";
    APPS.forEach((app, idx) => {
      const { icon, color } = pickIcon(app.title, app.desc);
      const art = document.createElement("article");
      art.className = "artwork";
      art.innerHTML = `
        <div class="rank-badge">No. ${String(idx + 1).padStart(2, "0")}</div>
        <div class="frame">
          <div class="canvas">
            <div class="placeholder" style="color:${color};background:radial-gradient(120% 120% at 50% 34%, ${color}2b, #141414 72%)">
              <i class="ti ${icon} p-icon" aria-hidden="true"></i>
              <span class="p-title">${esc(app.title)}</span>
            </div>
          </div>
        </div>
        <div class="plate">
          <h3>${esc(app.title)}</h3>
          <p class="artist"><i class="ti ti-brush" aria-hidden="true"></i> ${esc(app.artist)}</p>
          <p class="desc">${esc(app.desc)}</p>
          <div class="stars-slot" data-key="${esc(app.key)}">${starsHtml(0)}</div>
          <div class="plate-actions">
            <button class="act like" data-key="${esc(app.key)}">
              <i class="ti ti-heart" aria-hidden="true"></i><span class="lk-label">좋아요</span>
            </button>
            <button class="act comment" data-key="${esc(app.key)}" data-title="${esc(app.title)}" data-artist="${esc(app.artist)}">
              <i class="ti ti-message" aria-hidden="true"></i>댓글
            </button>
            ${app.url
              ? `<a class="act visit" href="${esc(app.url)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link" aria-hidden="true"></i>방문</a>`
              : `<span class="act visit visit-off" title="등록된 사이트 주소가 없습니다"><i class="ti ti-link-off" aria-hidden="true"></i>주소 없음</span>`
            }
          </div>
        </div>`;
      gallery.appendChild(art);

      // 실제 스크린샷이 images/ 에 있으면 자동 교체 (예: images/앱제목.png)
      tryRealImage(art, app);

      // 좋아요 상태 표시
      const likeBtn = art.querySelector(".act.like");
      if (Store.hasLiked(app.key)) markLikedUI(likeBtn);
    });

    // 좋아요 실시간 구독
    const keys = APPS.map((a) => a.key);
    Store.subscribeLikes(keys, updateStarSlot);
  }

  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  function updateStarSlot(key, count) {
    document.querySelectorAll(`.stars-slot[data-key="${cssEscape(key)}"]`)
      .forEach((el) => (el.innerHTML = starsHtml(count)));
  }

  function tryRealImage(art, app) {
    const exts = ["png", "jpg", "jpeg", "webp"];
    let i = 0;
    const canvas = art.querySelector(".canvas");
    const probe = new Image();
    probe.onload = function () {
      canvas.innerHTML = `<img src="${probe.src}" alt="${esc(app.title)} 화면" loading="lazy" />`;
    };
    probe.onerror = function () {
      i++;
      if (i < exts.length) probe.src = imgPath(app, exts[i]);
    };
    probe.src = imgPath(app, exts[0]);
  }
  function imgPath(app, ext) {
    return "images/" + encodeURIComponent(app.title) + "." + ext;
  }

  function markLikedUI(btn) {
    btn.classList.add("liked");
    const label = btn.querySelector(".lk-label");
    if (label) label.textContent = "좋아요 완료";
  }

  /* ---------- 이벤트 위임 ---------- */
  gallery.addEventListener("click", async (e) => {
    const likeBtn = e.target.closest(".act.like");
    if (likeBtn) {
      const key = likeBtn.dataset.key;
      if (Store.hasLiked(key)) return;
      likeBtn.disabled = true;
      const ok = await Store.like(key);
      if (ok) {
        markLikedUI(likeBtn);
        if (Store.mode === "local") updateStarSlot(key, Store.readLocalLikes(key));
      }
      likeBtn.disabled = false;
      return;
    }
    const cBtn = e.target.closest(".act.comment");
    if (cBtn) openComments(cBtn.dataset.key, cBtn.dataset.title, cBtn.dataset.artist);
  });

  /* ---------- 댓글 패널 ---------- */
  const overlay = document.getElementById("overlay");
  const commentList = document.getElementById("commentList");
  const commentInput = document.getElementById("commentInput");
  const nickInput = document.getElementById("nickInput");
  let currentKey = null;
  let unsubComments = null;

  function openComments(key, title, artist) {
    currentKey = key;
    document.getElementById("panelTitle").textContent = title;
    document.getElementById("panelMeta").textContent = artist;
    commentList.innerHTML = `<li class="comment-empty">댓글을 불러오는 중…</li>`;
    overlay.hidden = false;
    if (unsubComments) unsubComments();
    unsubComments = Store.subscribeComments(key, renderComments);
    commentInput.focus();
  }
  function closeComments() {
    overlay.hidden = true;
    if (unsubComments) { unsubComments(); unsubComments = null; }
    currentKey = null;
  }
  function renderComments(list) {
    if (!list || !list.length) {
      commentList.innerHTML = `<li class="comment-empty">아직 댓글이 없어요. 첫 응원을 남겨 주세요!</li>`;
      return;
    }
    commentList.innerHTML = list.map((c) => {
      let t = "";
      if (c.ts) {
        const d = c.ts.toDate ? c.ts.toDate() : new Date(c.ts);
        t = `${d.getMonth() + 1}.${d.getDate()}`;
      }
      return `<li>
        <span class="c-nick">${esc(c.nick || "익명")}</span>
        <span class="c-time">${esc(t)}</span>
        <p class="c-text">${esc(c.text)}</p>
      </li>`;
    }).join("");
  }
  async function submitComment() {
    if (!currentKey) return;
    const text = commentInput.value.trim();
    if (!text) return;
    commentInput.value = "";
    await Store.addComment(currentKey, nickInput.value.trim(), text);
  }
  document.getElementById("commentSubmit").addEventListener("click", submitComment);
  commentInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitComment(); });
  document.getElementById("panelClose").addEventListener("click", closeComments);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeComments(); });

  /* =================================================================
     데이터 로딩
     ================================================================= */
  function sheetUrl() {
    return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&gid=${CONFIG.SHEET_GID}`;
  }

  function colIndex(header, keyword) {
    for (let i = 0; i < header.length; i++) {
      if (String(header[i]).replace(/\s/g, "").includes(keyword.replace(/\s/g, ""))) return i;
    }
    return -1;
  }

  function buildApps(rows) {
    const header = rows[0] || [];
    const ci = {
      name: colIndex(header, "이름"),
      title: colIndex(header, "앱제목"),
      desc: colIndex(header, "앱설명"),   // "앱 설명, 사용법..." 포함 매칭
      url: colIndex(header, "사이트주소"), // "개발한 사이트 주소"
      teacher: colIndex(header, "선생님평가")
    };
    if (ci.desc === -1) ci.desc = colIndex(header, "설명");
    if (ci.url === -1) ci.url = colIndex(header, "주소");

    const list = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const name = (row[ci.name] || "").trim();
      if (!name) continue; // 빈 줄
      const teacherStars = countTeacherStars(row[ci.teacher]);
      if (teacherStars <= 0) continue; // 선생님 별 0개 → 전시 제외

      let title = (row[ci.title] || "").trim();
      if (!title && TITLE_OVERRIDES[name]) title = TITLE_OVERRIDES[name];
      if (!title) title = "(제목 없음)";

      const rawDesc = (row[ci.desc] || "").trim();
      const oKey = (row[ci.title] || "").trim() || name;
      const desc = DESCRIPTION_OVERRIDES[oKey] || rawDesc || "설명이 아직 없습니다.";

      const rawUrl = (row[ci.url] || "").trim();
      const url = isHttpUrl(rawUrl) ? rawUrl : "";

      list.push({
        artist: maskName(name),
        title, desc, url,
        teacherStars,
        order: r,
        key: appKey(name, title)
      });
    }
    // 선생님 평가 높은 순 → 같으면 시트 순서
    list.sort((a, b) => (b.teacherStars - a.teacherStars) || (a.order - b.order));
    return list;
  }

  async function load() {
    try {
      const res = await fetch(sheetUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      APPS = buildApps(parseCSV(text));
      if (!APPS.length) throw new Error("표시할 작품이 없습니다.");
      render();
      statusLine.textContent = `총 ${APPS.length}점의 작품이 전시 중입니다`;
    } catch (err) {
      statusLine.innerHTML = `작품을 불러오지 못했습니다. 시트가 "링크가 있는 모든 사용자에게 보기 공개"인지 확인해 주세요.<br><small>${esc(err.message)}</small>`;
    }
    const note = document.getElementById("modeNote");
    note.textContent = Store.mode === "firebase"
      ? "좋아요·댓글이 모든 방문자와 실시간으로 공유됩니다."
      : "⚠ 미리보기 모드: 좋아요·댓글이 이 브라우저에만 저장됩니다. (Firebase 설정 시 전체 공유)";
  }

  load();
})();
