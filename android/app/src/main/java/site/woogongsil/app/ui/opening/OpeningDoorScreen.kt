package site.woogongsil.app.ui.opening

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** UI 테스트와 실기기 점검에서 사용하는 안정적인 화면 식별자입니다. */
object OpeningTestTags {
    const val ROOT = "opening_root"
    const val LEFT_DOOR = "opening_left_door"
    const val RIGHT_DOOR = "opening_right_door"
}

/** 우공실의 콜드 스타트 오프닝은 본문 전환까지 약 2.95초로 재생합니다. */
private object OpeningMotion {
    const val HOLD_MILLIS = 450L
    const val OPEN_MILLIS = 1_800
    const val END_HOLD_MILLIS = 250L
    const val REVEAL_MILLIS = 450
}

/** 이 오프닝의 두 애니메이션에만 적용하며 기기·다른 앱의 설정은 변경하지 않습니다. */
private object OpeningMotionScale : MotionDurationScale {
    override val scaleFactor = 1f
}

/** 본문을 한 번만 구성한 뒤 오프닝을 페이드아웃해 로딩 시작 지연과 화면 교체를 줄입니다. */
@Composable
internal fun OpeningDoorContainer(
    playOpening: Boolean,
    onOpeningBack: () -> Unit = {},
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    var openingFinished by rememberSaveable { mutableStateOf(false) }

    Box(
        modifier = modifier
            .fillMaxSize()
            // 투명 WebView가 아직 그리지 않은 영역도 테마 배경으로 채웁니다.
            .background(MaterialTheme.colorScheme.background),
    ) {
        content()

        if (playOpening && !openingFinished) {
            // 오프닝 중 뒤로가기는 이전처럼 앱을 닫습니다. 본문 전환 뒤 웹 뒤로가기가 이어집니다.
            BackHandler(onBack = onOpeningBack)
            OpeningDoorScreen(
                onFinished = { openingFinished = true },
                modifier = Modifier.pointerInput(Unit) {
                    // 페이드아웃이 끝날 때까지 문을 누른 터치가 뒤 본문으로 전달되지 않습니다.
                    awaitPointerEventScope {
                        while (true) {
                            awaitPointerEvent(PointerEventPass.Initial).changes.forEach { it.consume() }
                        }
                    }
                },
            )
        }
    }
}

/**
 * 앱의 첫 실행 인상을 담당하는 양문형 오프닝 화면입니다.
 *
 * - 잠시 멈춤 450ms → 문 열림 1800ms → 여운 250ms → 본문으로 넘김 450ms 순서입니다.
 * - 사용자 요청한 문 열림은 앱 내부에서 시간을 고정하며 전역 애니메이션 설정은 바꾸지 않습니다.
 * - 화면 회전으로 Activity가 재생성되면 상위 콜드 스타트 조건으로 반복을 막습니다.
 * - 네트워크나 웹 로딩과 분리해, 사이트 장애가 있어도 애니메이션이 멈추지 않습니다.
 */
@Composable
fun OpeningDoorScreen(
    onFinished: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val progress = remember { Animatable(0f) }
    val opacity = remember { Animatable(1f) }
    val currentOnFinished by rememberUpdatedState(onFinished)

    // [애니메이션 순서] 로고를 잠깐 인지시킨 뒤 두 문을 동시에 열고 종료합니다.
    LaunchedEffect(Unit) {
        withContext(OpeningMotionScale) {
            delay(OpeningMotion.HOLD_MILLIS)
            progress.animateTo(
                targetValue = 1f,
                animationSpec = tween(
                    durationMillis = OpeningMotion.OPEN_MILLIS,
                    easing = FastOutSlowInEasing,
                ),
            )
            delay(OpeningMotion.END_HOLD_MILLIS)
            opacity.animateTo(
                targetValue = 0f,
                animationSpec = tween(
                    durationMillis = OpeningMotion.REVEAL_MILLIS,
                    easing = FastOutSlowInEasing,
                ),
            )
        }
        currentOnFinished()
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .graphicsLayer { alpha = opacity.value }
            .background(
                Brush.radialGradient(
                    colors = listOf(Color(0xFF274B7A), Color(0xFF0A1830)),
                    center = Offset.Unspecified,
                ),
            )
            .testTag(OpeningTestTags.ROOT),
        contentAlignment = Alignment.Center,
    ) {
        // [문 뒤 콘텐츠] 문이 열릴 때 보이는 브랜드명입니다.
        Text(
            text = "우공실",
            color = Color.White,
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Black,
            modifier = Modifier.alpha(0.35f + (progress.value * 0.65f)),
        )

        DoorPanel(
            isLeft = true,
            progress = progress.value,
            modifier = Modifier
                .align(Alignment.CenterStart)
                .testTag(OpeningTestTags.LEFT_DOOR),
        )
        DoorPanel(
            isLeft = false,
            progress = progress.value,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .testTag(OpeningTestTags.RIGHT_DOOR),
        )
    }
}

/** 한쪽 문짝의 이동·회전과 손잡이를 담당합니다. */
@Composable
private fun DoorPanel(
    isLeft: Boolean,
    progress: Float,
    modifier: Modifier = Modifier,
) {
    var panelWidthPx by remember { mutableIntStateOf(0) }
    val direction = if (isLeft) -1f else 1f
    val hinge = if (isLeft) 0f else 1f

    Box(
        modifier = modifier
            .fillMaxWidth(0.5f)
            .fillMaxHeight()
            .onSizeChanged { panelWidthPx = it.width }
            .graphicsLayer {
                // [양문 개방] 바깥쪽으로 이동하면서 외측 경첩을 기준으로 회전합니다.
                translationX = direction * panelWidthPx * progress
                rotationY = -direction * 62f * progress
                transformOrigin = TransformOrigin(hinge, 0.5f)
                cameraDistance = 18f * density
                alpha = 1f - (progress * 0.12f)
            }
            .background(
                Brush.horizontalGradient(
                    colors = if (isLeft) {
                        listOf(Color(0xFF0D2345), Color(0xFF244E80))
                    } else {
                        listOf(Color(0xFF244E80), Color(0xFF0D2345))
                    },
                ),
            ),
    ) {
        // [문 중앙선] 닫힌 상태에서 양쪽 문 경계를 또렷하게 표시합니다.
        Box(
            modifier = Modifier
                .align(if (isLeft) Alignment.CenterEnd else Alignment.CenterStart)
                .width(1.dp)
                .fillMaxHeight()
                .background(Color.White.copy(alpha = 0.24f)),
        )

        // [손잡이] 실제 버튼이 아닌 장식 요소라 클릭 동작을 부여하지 않습니다.
        Box(
            modifier = Modifier
                .align(if (isLeft) Alignment.CenterEnd else Alignment.CenterStart)
                .graphicsLayer {
                    translationX = if (isLeft) -14.dp.toPx() else 14.dp.toPx()
                }
                .width(11.dp)
                .fillMaxHeight(0.028f)
                .background(Color(0xFFD9B96E), CircleShape),
        )
    }
}
