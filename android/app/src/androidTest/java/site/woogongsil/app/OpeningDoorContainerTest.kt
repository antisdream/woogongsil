package site.woogongsil.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import site.woogongsil.app.ui.opening.OpeningDoorContainer
import site.woogongsil.app.ui.opening.OpeningTestTags
import site.woogongsil.app.ui.theme.WoogongsilTheme

/** 실제 웹 요청 없이 시간·본문 수명·오프닝 터치 차단을 검사합니다. */
class OpeningDoorContainerTest {
    @get:Rule
    val composeRule = createComposeRule(
        // 실제 기기의 배율0 환경을 테스트 안에서 재현하며 전역 설정은 바꾸지 않습니다.
        effectContext = object : MotionDurationScale {
            override val scaleFactor = 0f
        },
    )

    @Test
    fun opening_keepsRequestedTimingWithSystemMotionOff_andBlocksTouchesUntilFadeFinishes() {
        var created = 0
        var disposed = 0
        var bodyTouches = 0
        composeRule.mainClock.autoAdvance = false
        composeRule.setContent {
            WoogongsilTheme {
                OpeningDoorContainer(playOpening = true) {
                    DisposableEffect(Unit) {
                        created += 1
                        onDispose { disposed += 1 }
                    }
                    Box(
                        Modifier
                            .fillMaxSize()
                            .testTag(BODY)
                            .clickable { bodyTouches += 1 },
                    ) {
                        Text("준비된 본문")
                    }
                }
            }
        }

        // 본문은 문이 닫혀 있을 때부터 구성되며 터치는 오프닝에서 소비합니다.
        composeRule.onNodeWithTag(BODY).assertExists()
        composeRule.onNodeWithTag(OpeningTestTags.ROOT).performTouchInput { click() }
        composeRule.runOnIdle {
            assertEquals(1, created)
            assertEquals(0, bodyTouches)
        }

        // 기존의 빠른 전환 시각을 지나도 문 열림이 진행 중입니다.
        composeRule.mainClock.advanceTimeBy(2_000)
        composeRule.onNodeWithTag(OpeningTestTags.ROOT).assertExists()

        // 문 열림·여운 뒤에는 즉시 교체하지 않고 페이드아웃이 이어집니다.
        composeRule.mainClock.advanceTimeBy(700)
        composeRule.onNodeWithTag(OpeningTestTags.ROOT).performTouchInput { click() }
        composeRule.runOnIdle { assertEquals(0, bodyTouches) }

        composeRule.mainClock.advanceTimeBy(600)
        composeRule.onNodeWithTag(OpeningTestTags.ROOT).assertDoesNotExist()
        composeRule.onNodeWithTag(BODY).performTouchInput { click() }
        composeRule.runOnIdle {
            assertEquals(1, created)
            assertEquals(0, disposed)
            assertEquals(1, bodyTouches)
        }
    }

    @Test
    fun skippedOpening_showsInteractiveBodyWithoutAnyAnimationDelay() {
        var bodyTouches = 0
        composeRule.mainClock.autoAdvance = false
        composeRule.setContent {
            WoogongsilTheme {
                // 루트가 Activity 재생성에 사용하는 분기입니다. 전역 배율0은 생략 조건이 아닙니다.
                OpeningDoorContainer(playOpening = false) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .testTag(BODY)
                            .clickable { bodyTouches += 1 },
                    ) {
                        Text("바로 표시된 본문")
                    }
                }
            }
        }

        composeRule.onNodeWithTag(OpeningTestTags.ROOT).assertDoesNotExist()
        composeRule.onNodeWithTag(BODY).performTouchInput { click() }
        composeRule.runOnIdle { assertEquals(1, bodyTouches) }
    }

    private companion object {
        const val BODY = "opening_test_body"
    }
}
