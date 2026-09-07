// 기존 게시판 posts 라우터 파일에 추가할 코드입니다.
// 기존 /api/posts/notice 라우터 근처에 붙여 넣으면 됩니다.
// 전제: posts 배열 또는 게시글 데이터에 isNotice, noticeOrder 값을 저장할 수 있어야 합니다.
// JSON 파일 저장 방식이면 savePosts(posts) 같은 기존 저장 함수를 그대로 사용하세요.

router.put("/notice-order", (req, res) => {
  const { userId, orderedIds } = req.body;

  if (userId !== "skn29") {
    return res.status(403).json({ success: false, msg: "관리자만 공지 순서를 변경할 수 있습니다." });
  }

  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ success: false, msg: "orderedIds 배열이 필요합니다." });
  }

  // posts는 기존 게시판 라우터에서 사용 중인 게시글 배열 변수명을 그대로 맞춰주세요.
  posts = posts.map(post => {
    const orderIndex = orderedIds.indexOf(post.id);
    if (post.isNotice && orderIndex >= 0) {
      return { ...post, noticeOrder: orderIndex };
    }
    return post;
  });

  // JSON 파일 저장 함수명이 프로젝트마다 다를 수 있습니다.
  // 예: savePosts(posts), writePosts(posts), fs.writeFileSync(...) 등 기존 라우터의 저장 방식을 그대로 호출하세요.
  savePosts(posts);

  res.json({ success: true });
});
