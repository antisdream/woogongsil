// 자주 묻는 질문 라우트 페이지 컴포넌트입니다.
import React, { useMemo, useState } from 'react';

// 자주 묻는 질문 화면 구성
// ------------------------------------------------------------
// 역할:
// 1. 우공실 사용자가 자주 묻는 내용을 표 형태로 안내합니다.
// 2. 질문을 클릭하면 답변이 바로 아래 행에 펼쳐집니다.
// 3. 페이지네이션은 FAQ 표 바로 아래에 배치하고, 검색 영역은 그 아래에 배치했습니다.
// 4. 기존 라우팅/로그인/게시판 로직과 연결되는 부분은 없으므로 다른 기능에 영향을 주지 않습니다.
// 수정사항:
// - 문자열 안의 <br />, <br>, <br\> 등을 React 화면에서 실제 줄바꿈으로 렌더링하도록 처리했습니다.
// - dangerouslySetInnerHTML은 사용하지 않아 XSS 위험을 줄였습니다.

const FAQ_LIST = [
    // FAQ 데이터
    // - 화면 로직은 그대로 유지하고, 사용자가 자주 헷갈리는 흐름 중심으로 정리합니다.
    // - answer 안의 \n 또는 <br /> 문자열은 renderAnswerText 함수에서 실제 줄바꿈으로 변환됩니다.
    {
        category: '서비스 이용',
        question: '우공실은 어떤 서비스인가요?',
        answer:
            '우공실은 정보처리기사 필기와 실기 학습을 한 화면에서 관리할 수 있는 시험 대비 서비스입니다.\n' +
            '필기 문제은행, 필기 기출문제, 실기 문제은행, 실기 기출문제, 오답노트, 게시판, FAQ를 제공합니다.',
    },
    {
        category: '계정/로그인',
        question: '회원가입과 로그인이 필요한 이유는 무엇인가요?',
        answer:
            '문제 풀이 기록, 오답노트, 랭킹, 게시판 이용 기록을 개인별로 저장하기 위해 로그인이 필요합니다.\n' +
            '로그인하면 PC를 새로고침하거나 다시 접속해도 본인의 학습 흐름을 이어갈 수 있습니다.',
    },
    {
        category: '계정/로그인',
        question: '비밀번호를 잊어버렸을 때는 어떻게 해야 하나요?',
        answer:
            '로그인 화면의 비밀번호 찾기 기능을 이용해 주세요.\n' +
            '가입 시 사용한 이메일 인증을 통해 비밀번호 재설정 절차를 진행할 수 있습니다.',
    },
    {
        category: '계정/로그인',
        question: '로그인 유지 시간은 얼마나 되나요?',
        answer:
            '상단 상태 영역에서 남은 로그인 유지 시간을 확인할 수 있습니다.\n' +
            '시간이 만료되면 자동으로 로그아웃될 수 있으니, 시험 응시 중에는 남은 시간을 확인해 주세요.',
    },
    {
        category: '계정/로그인',
        question: '다른 기기에서도 중복 로그인이 가능한가요?',
        answer:
            '계정 보안을 위해 같은 계정으로 여러 환경에서 접속할 경우 이전 세션이 만료될 수 있습니다.\n' +
            '시험 응시 중에는 한 기기에서만 안정적으로 접속하는 것을 권장합니다.',
    },

    {
        category: '필기문제',
        question: '필기 문제은행과 필기 기출문제는 어떤 차이가 있나요?',
        answer:
            '필기 문제은행은 과목별 랜덤 문제를 풀며 개념을 반복 학습하는 기능입니다.\n' +
            '필기 기출문제는 연도와 회차를 선택해 실제 시험처럼 응시하는 기능입니다.',
    },
    {
        category: '필기문제',
        question: '필기 기출문제 응시 중 페이지를 벗어날 수 있나요?',
        answer:
            '기출문제 응시 중에는 시험 흐름 유지를 위해 이탈 경고가 표시될 수 있습니다.\n' +
            '실수로 페이지를 닫거나 뒤로 가기를 누르지 않도록 주의해 주세요.',
    },
    {
        category: '필기문제',
        question: '필기 문제에서 오류를 발견하면 어떻게 하나요?',
        answer:
            '문제 풀이 화면의 오류신고 버튼을 이용하거나 게시판에 내용을 남겨 주세요.\n' +
            '문제 번호, 보기, 정답, 의심되는 이유를 함께 적어주시면 확인이 빠릅니다.',
    },
    {
        category: '필기문제',
        question: '필기 기출문제를 다시 풀면 기록은 어떻게 반영되나요?',
        answer:
            '같은 연도와 같은 회차를 다시 응시하면 최신 제출 결과가 기준으로 반영됩니다.\n' +
            '랭킹과 점수 확인은 마지막으로 제출한 결과를 기준으로 보는 것이 가장 정확합니다.',
    },

    {
        category: '실기문제',
        question: '실기 문제은행과 실기 기출문제는 어떤 차이가 있나요?',
        answer:
            '실기 문제은행은 과목별 랜덤 문제 또는 전체 과목 섞기 방식으로 단답형 문제를 빠르게 연습하는 기능입니다.\n' +
            '실기 기출문제는 연도와 회차를 선택해 실제 시험처럼 20문제를 풀고 최종 결과를 확인하는 기능입니다.',
    },
    {
        category: '실기문제',
        question: '실기 답안은 어떤 방식으로 입력해야 하나요?',
        answer:
            '문제에서 요구하는 답안을 입력칸에 작성하면 됩니다.\n' +
            '여러 답을 요구하는 문제는 쉼표(,) 또는 줄바꿈으로 구분해 입력하는 것이 좋습니다.\n' +
            '코드 출력형이나 SQL형 문제는 채점유형에 따라 공백, 줄바꿈, 문법 기호가 중요할 수 있습니다.',
    },
    {
        category: '실기문제',
        question: '실기 문제는 모두 자동 채점되나요?',
        answer:
            '대부분의 단답형, 용어형, SQL형, 코드 출력형 문제는 자동 채점됩니다.\n' +
            '다만 긴 서술형처럼 자동 판정이 어려운 문제는 SELF_CHECK 방식으로 제공될 수 있으며, 이 경우 정답 예시를 보고 직접 확인해야 합니다.',
    },
    {
        category: '실기문제',
        question: '실기 기출문제는 실제 시험처럼 점수가 계산되나요?',
        answer:
            '실기 기출문제는 회차별 20문제 기준으로 응시하며, 문제별 배점과 채점 결과를 바탕으로 점수가 계산됩니다.\n' +
            '부분점수가 있는 문제는 채점 결과에 따라 일부 점수만 반영될 수 있습니다.',
    },
    {
        category: '실기문제',
        question: '실기 기출문제를 다시 풀면 기록은 어떻게 반영되나요?',
        answer:
            '같은 연도와 같은 회차를 다시 응시하면 최신 제출 결과가 기준으로 반영됩니다.\n' +
            '랭킹과 점수 확인은 마지막으로 제출한 결과를 기준으로 보는 것이 가장 정확합니다.',
    },

    // 실기 채점유형 안내
    // - 현재 백엔드 채점 로직에서 지원하는 유형 기준으로 정리했습니다.
    // - 사용자에게는 내부 코드명과 실제 의미를 함께 보여줍니다.
    {
        category: '실기 채점유형',
        question: '실기 채점유형은 무엇인가요?',
        answer:
            '실기 문제는 문제 성격에 따라 채점 기준이 다르게 적용됩니다.\n' +
            '현재 사용되는 채점유형은 FLEX_TERM, MULTI_TERM, EXACT_OUTPUT, SQL_TEXT, SELF_CHECK입니다.\n' +
            '문제 화면의 채점유형 표시는 답안을 어떤 기준으로 입력해야 하는지 알려주는 안내 역할을 합니다.',
    },
    {
        category: '실기 채점유형',
        question: 'FLEX_TERM 채점유형은 무엇인가요?',
        answer:
            'FLEX_TERM은 일반 용어형 단답 문제에 사용하는 유연 채점 방식입니다.\n' +
            '영어 대소문자, 공백, 쉼표, 하이픈, 일부 문장부호 차이를 완화해서 비교합니다.\n' +
            '예를 들어 용어의 핵심 철자와 의미가 맞으면 표기 방식이 조금 달라도 정답으로 인정될 수 있습니다.\n' +
            '단, 아예 다른 용어이거나 핵심 단어가 빠진 경우에는 오답 처리될 수 있습니다.',
    },
    {
        category: '실기 채점유형',
        question: 'MULTI_TERM 채점유형은 무엇인가요?',
        answer:
            'MULTI_TERM은 정답이 여러 개인 문제에 사용하는 복수 용어 채점 방식입니다.\n' +
            '여러 답안을 쉼표(,) 또는 줄바꿈으로 구분해 입력하면 각 항목을 나누어 채점합니다.\n' +
            '정답 중 일부만 맞힌 경우에는 문제 설정에 따라 부분점수가 반영될 수 있습니다.\n' +
            '답안 순서가 중요하지 않은 문제라면 핵심 항목이 포함되어 있는지가 더 중요합니다.',
    },
    {
        category: '실기 채점유형',
        question: 'EXACT_OUTPUT 채점유형은 무엇인가요?',
        answer:
            'EXACT_OUTPUT은 코드 실행 결과처럼 출력값이 정확해야 하는 문제에 사용하는 채점 방식입니다.\n' +
            '대소문자, 공백, 줄바꿈, 기호가 결과에 영향을 줄 수 있으므로 문제에서 요구한 출력 형태를 최대한 그대로 입력해야 합니다.\n' +
            '앞뒤 불필요한 공백 정도는 정리되지만, 중간 출력 형식이 다르면 오답 처리될 수 있습니다.',
    },
    {
        category: '실기 채점유형',
        question: 'SQL_TEXT 채점유형은 무엇인가요?',
        answer:
            'SQL_TEXT는 SQL 작성 문제에 사용하는 채점 방식입니다.\n' +
            'SQL 키워드의 대소문자 차이, 여러 칸 공백, 마지막 세미콜론 유무는 비교 시 완화될 수 있습니다.\n' +
            '하지만 SELECT, FROM, WHERE, JOIN, 괄호, 쉼표, 비교연산자 같은 문법 구조는 중요합니다.\n' +
            '정답과 같은 의미의 SQL이라도 현재 채점 기준과 문법 구조가 크게 다르면 오답 처리될 수 있습니다.',
    },
    {
        category: '실기 채점유형',
        question: 'SELF_CHECK 채점유형은 무엇인가요?',
        answer:
            'SELF_CHECK는 자동 채점이 어려운 서술형 문제에 사용하는 자기 확인 방식입니다.\n' +
            '답안을 작성한 뒤 정답 예시와 해설을 보고 본인이 맞음, 틀림, 부분 인정 여부를 확인하는 흐름입니다.\n' +
            '긴 설명형 문제는 표현이 다양할 수 있으므로 핵심 키워드와 논리가 들어갔는지 확인해 주세요.',
    },
    {
        category: '실기 채점유형',
        question: '실기 답안 작성 시 가장 안전한 방법은 무엇인가요?',
        answer:
            '용어형은 핵심 용어를 정확히 쓰고, 여러 답은 쉼표 또는 줄바꿈으로 구분해 주세요.\n' +
            '코드 출력형은 출력 결과를 그대로 작성하고, SQL형은 문법 기호와 조건식을 정확히 작성하는 것이 좋습니다.\n' +
            '서술형은 정답 예시와 비교할 수 있도록 핵심 키워드와 이유를 빠뜨리지 않는 것이 좋습니다.',
    },

    {
        category: '오답노트',
        question: '오답노트에는 어떤 문제가 저장되나요?',
        answer:
            '틀린 문제 또는 복습이 필요한 문제를 오답노트에서 다시 확인할 수 있습니다.\n' +
            '오답노트는 필기 문제은행, 필기 기출문제, 실기 문제은행, 실기 기출문제로 구분해 관리됩니다.',
    },
    {
        category: '오답노트',
        question: '기출문제 오답은 어떻게 복습하나요?',
        answer:
            '마이페이지의 오답노트에서 기출문제 탭을 선택한 뒤 연도와 회차를 필터링하면 됩니다.\n' +
            '필기와 실기 기출 오답은 각각 따로 복습할 수 있습니다.',
    },
    {
        category: '오답노트',
        question: '오답노트를 삭제할 수 있나요?',
        answer:
            '오답노트 화면에서 현재 오답을 삭제하거나, 탭별 전체 삭제 기능을 사용할 수 있습니다.\n' +
            '삭제한 기록은 복구가 어려울 수 있으니 필요한 오답인지 먼저 확인해 주세요.',
    },

    {
        category: '랭킹',
        question: '랭킹은 언제 운영되나요?',
        answer:
            '랭킹은 서버 로컬 시간 기준으로 매일 00시 00분 00초부터 23시 59분 59초까지 24시간 운영됩니다.\n' +
            '프리시즌 없이 하루 단위로 계속 갱신되며, 날짜가 바뀌면 해당 날짜 랭킹으로 새로 집계됩니다.',
    },
    {
        category: '랭킹',
        question: '프리시즌에는 랭킹이 어떻게 보이나요?',
        answer:
            '프리시즌은 폐지되었습니다.\n' +
            '필기 문제은행, 필기 기출문제, 실기 문제은행, 실기 기출문제 모두 24시간 랭킹에 바로 반영됩니다.',
    },
    {
        category: '랭킹',
        question: '실기 문제은행 랭킹은 어떻게 계산되나요?',
        answer:
            '실기 문제은행은 사용자가 푼 문제 수와 맞힌 문제 수가 누적되어 정답률이 계산됩니다.\n' +
            '예를 들어 총 5문제를 풀고 3문제를 맞히면 정답률은 60%이며, 화면에는 60% (3/5) 형태로 표시될 수 있습니다.',
    },
    {
        category: '랭킹',
        question: '실기 기출문제 랭킹은 어떻게 계산되나요?',
        answer:
            '실기 기출문제는 회차별 20문제 응시 결과를 기준으로 반영됩니다.\n' +
            '부분점수가 있는 문제는 점수에는 부분점수가 반영되고, 정답률 계산에서는 채점된 문제 기준으로 맞힌 개수를 반영합니다.\n' +
            '같은 회차를 다시 제출하면 최신 제출 결과가 랭킹에 반영됩니다.',
    },

    {
        category: '게시판',
        question: '게시판에는 어떤 글을 남기면 되나요?',
        answer:
            '오류 신고, 문제 정정 요청, 기능 개선 의견, 공지 확인과 관련된 글을 남길 수 있습니다.\n' +
            '문제 오류를 제보할 때는 문제 페이지의 오류신고 버튼을 이용하시거나 게시판에 메뉴, 연도, 회차, 문제 번호를 함께 적어주시면 좋습니다.',
    },
    {
        category: '게시판',
        question: '공지사항은 꼭 확인해야 하나요?',
        answer:
            '기출문제 응시, 실기 기능 업데이트, 데이터 수정, 시험 운영 방식 변경은 공지사항으로 안내될 수 있습니다.\n' +
            '특히 기출문제 응시 전에는 공지사항을 한 번 확인하는 것을 권장합니다.',
    },

    {
        category: '화면/테마',
        question: '다크모드와 라이트모드는 어떻게 바꾸나요?',
        answer:
            '화면 상단의 다크/라이트 토글 버튼을 눌러 테마를 바꿀 수 있습니다.\n' +
            '선택한 테마는 여러 페이지에서 동일하게 적용되도록 구성되어 있습니다.',
    },
    {
        category: '화면/테마',
        question: '모바일에서도 사용할 수 있나요?',
        answer:
            '모바일에서도 접속할 수 있지만, 기출문제 응시와 결과 확인은 화면이 넓은 PC 환경에서 더 편하게 사용할 수 있습니다.\n' +
            '장문 답안을 작성해야 하는 실기 문제는 화면모드를 가로모드로 변경하시거나 키보드가 있는 환경을 권장합니다.',
    },
    {
        category: '화면/테마',
        question: '글씨가 잘 보이지 않을 때는 어떻게 하나요?',
        answer:
            '먼저 다크모드와 라이트모드를 전환해 보고, 브라우저 확대 비율을 100%로 맞춰 주세요.\n' +
            '특정 페이지에서만 글씨가 흐리거나 보이지 않는다면 그 부분을 게시판에 알려 주세요.',
    },
];

const ITEMS_PER_PAGE = 10;

// 답변 줄바꿈 렌더링 함수
// ------------------------------------------------------------
// React는 문자열 안의 "<br />"을 HTML로 해석하지 않습니다.
// 그래서 문자열을 <br />, <br>, <br\> 기준으로 나눈 뒤,
// React Fragment와 <br /> 태그를 직접 반환합니다.
// 예)
// "첫 줄<br />둘째 줄"
// 첫 줄
//  둘째 줄
// dangerouslySetInnerHTML을 쓰지 않으므로 보안상 더 안전합니다.
const FAQ = () => {
    const [currentPage, setCurrentPage] = useState(1);
    const [openIdx, setOpenIdx] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [submittedSearch, setSubmittedSearch] = useState('');

    const filteredList = useMemo(() => {
        const keyword = submittedSearch.trim().toLowerCase();
        if (!keyword) return FAQ_LIST;

        // 검색 대상: 분류, 질문, 답변
        // 중요: FAQ_LIST 데이터 키가 question/answer이므로 q/a로 접근하면 화면 공백 및 검색 오류가 발생합니다.
        return FAQ_LIST.filter((item) => {
            return (
                String(item.category || '').toLowerCase().includes(keyword) ||
                String(item.question || '').toLowerCase().includes(keyword) ||
                String(item.answer || '').toLowerCase().includes(keyword)
            );
        });
    }, [submittedSearch]);

    const totalPages = Math.max(1, Math.ceil(filteredList.length / ITEMS_PER_PAGE));
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const currentItems = filteredList.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const handleToggle = (actualIdx) => {
        // 같은 질문을 다시 누르면 닫고, 다른 질문을 누르면 기존 답변을 닫고 새 답변을 엽니다.
        setOpenIdx((prev) => (prev === actualIdx ? null : actualIdx));
    };

    const handlePageMove = (nextPage) => {
        if (nextPage < 1 || nextPage >totalPages) return;
        setCurrentPage(nextPage);
        setOpenIdx(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSearch = (event) => {
        event.preventDefault();
        setSubmittedSearch(searchTerm.trim());
        setCurrentPage(1);
        setOpenIdx(null);
    };

    const handleClearSearch = () => {
        setSearchTerm('');
        setSubmittedSearch('');
        setCurrentPage(1);
        setOpenIdx(null);
    };

    // FAQ 답변 줄바꿈 렌더링 함수
// - 문자열 안에 작성한 <br />, <br>, <br \> 등을 실제 줄바꿈으로 변환합니다.
// - dangerouslySetInnerHTML을 쓰지 않아 XSS 위험 없이 안전하게 처리합니다.
// - FAQ 데이터 구조(question, answer)에 맞춰 안전하게 처리합니다.
const renderAnswerText = (answerText) => {
    const safeText = String(answerText || '');

    // <br />, <br>, <br \> 모두 줄바꿈 구분자로 인식
    const lines = safeText.split(/<br\s*[/\\]?\s*>/gi);

    return lines.map((line, index) => (
        <React.Fragment key={`faq-answer-line-${index}`}>
            {line.trim()}
            {index < lines.length - 1 && <br />}
        </React.Fragment>
    ));
};

    return (
        <div className="faq-page-wrap wgs-typography-scope">
            <section className="faq-card">
                <div className="faq-header">
                    <h2> 자주 묻는 질문 (FAQ)</h2>
                    <p>
                        직접 정보를 찾아보거나 하단의 검색창에 분류 또는 키워드를 입력하여 원하는 정보를 찾을 수 있습니다.
                    </p>
                </div>
                <div className="faq-table-wrap">
                    <table className="faq-table">
                        <thead>
                            <tr>
                                <th style={{ width: '70px' }}>No</th>
                                <th style={{ width: '140px' }}>분류</th>
                                <th>질문</th>
                                <th style={{ width: '90px' }}>보기</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentItems.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="faq-empty-cell">
                                        검색 결과가 없습니다. 다른 검색어로 다시 시도해 주세요.
                                    </td>
                                </tr>
                            ) : (
                                currentItems.map((item, idx) => {
                                    const actualIdx = startIndex + idx;
                                    const isOpen = openIdx === actualIdx;

                                    return (
                                        <React.Fragment key={`${item.category}-${item.question}`}>
                                            <tr className={isOpen ? 'is-open' : ''}>
                                                <td>{actualIdx + 1}</td>
                                                <td>
                                                    <span className="faq-category-badge">
                                                        {item.category}
                                                    </span>
                                                </td>
                                                <td className="faq-question-cell">
                                                    <button
                                                        type="button" onClick={() => handleToggle(actualIdx)}
                                                    >
                                                        {/* question 키를 사용해야 질문 문구가 화면에 정상 출력됩니다. */}
                                                        Q. {item.question}
                                                    </button>
                                                </td>
                                                <td>
                                                    <button
                                                        type="button" className="faq-open-btn" onClick={() => handleToggle(actualIdx)}
                                                        aria-expanded={isOpen}
                                                    >
                                                        {isOpen ? '닫기' : '열기'}
                                                    </button>
                                                </td>
                                            </tr>

                                            {isOpen && (
                                                <tr className="faq-answer-row">
                                                    <td>A.</td>
                                                    <td colSpan="3" className="faq-answer-cell" style={{ textAlign: "left" }}>
                                                        {/* 
                                                             수정 핵심:
                                                            기존 <p>{item.a}</p>는 문자열 안의 <br />을 그대로 출력합니다.
                                                            renderAnswerText()를 사용해 실제 줄바꿈으로 변환합니다.
                                                        */}
                                                        <p className="faq-answer-text">{/* answer 키를 사용해야 답변 문구와 줄바꿈이 정상 출력됩니다. */}
                                                            {renderAnswerText(item.answer)}</p>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="faq-pagination" aria-label="FAQ 페이지 이동">
                    <button
                        type="button" onClick={() => handlePageMove(currentPage - 1)}
                        disabled={currentPage === 1}
                    >
                        &lt;
                    </button>

                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNo) => (
                        <button
                            key={pageNo}
                            type="button" className={currentPage === pageNo ? 'is-active' : ''}
                            onClick={() => handlePageMove(pageNo)}
                        >
                            {pageNo}
                        </button>
                    ))}

                    <button
                        type="button" onClick={() => handlePageMove(currentPage + 1)}
                        disabled={currentPage === totalPages}
                    >
                        &gt;
                    </button>
                </div>

                {/* 검색 입력창과 검색 버튼은 페이지네이션 아래쪽에 유지합니다. */}
                <form className="faq-search-form faq-search-bottom" onSubmit={handleSearch}>
                    <input
                        type="text" value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="검색어를 입력하세요. 예: 오답노트, 기출문제, 로그인, 게시판"
                    />
                    <button type="submit" className="faq-search-btn">
                        검색
                    </button>

                    {submittedSearch && (
                        <button
                            type="button" className="faq-reset-btn" onClick={handleClearSearch}
                        >
                            초기화
                        </button>
                    )}
                </form>

                {submittedSearch && (
                    <div className="faq-search-result">
                        “{submittedSearch}” 검색 결과: {filteredList.length}건
                    </div>
                )}
            </section>
        </div>
    );
};

export default FAQ;
