import {
  CONTAINER_GRID_PADDING,
  GridDefaults,
} from "constants/WidgetConstants";
import { debounce, isEmpty, throttle } from "lodash";
import { CanvasDraggingArenaProps } from "pages/common/CanvasDraggingArena";
import { useEffect, useRef } from "react";
import { ReflowDirection, ReflowedSpaceMap } from "reflow/reflowTypes";
import { useReflow, ReflowInterface } from "utils/hooks/useReflow";
import { useSelector } from "react-redux";
import { getZoomLevel } from "selectors/editorSelectors";
import { getNearestParentCanvas } from "utils/generators";
import { getDropZoneOffsets, noCollision } from "utils/WidgetPropsUtils";
import { useWidgetDragResize } from "./dragResizeHooks";
import {
  useBlocksToBeDraggedOnCanvas,
  WidgetDraggingBlock,
} from "./useBlocksToBeDraggedOnCanvas";
import { useCanvasDragToScroll } from "./useCanvasDragToScroll";
import { OccupiedSpace } from "constants/CanvasEditorConstants";
import { isReflowEnabled } from "selectors/widgetReflowSelectors";

export interface XYCord {
  x: number;
  y: number;
}
export const useCanvasDragging = (
  canvasRef: React.RefObject<HTMLDivElement>,
  canvasDrawRef: React.RefObject<HTMLCanvasElement>,
  {
    canExtend,
    dropDisabled,
    noPad,
    snapColumnSpace,
    snapRows,
    snapRowSpace,
    widgetId,
  }: CanvasDraggingArenaProps,
) => {
  const canvasZoomLevel = useSelector(getZoomLevel);
  const currentDirection = useRef<ReflowDirection>(ReflowDirection.UNSET);
  const { devicePixelRatio: scale = 1 } = window;
  const reflowEnabled = useSelector(isReflowEnabled);
  const {
    blocksToDraw,
    defaultHandlePositions,
    getSnappedXY,
    isChildOfCanvas,
    isCurrentDraggedCanvas,
    isDragging,
    isNewWidget,
    isNewWidgetInitialTargetCanvas,
    isResizing,
    lastDraggedCanvas,
    occSpaces,
    onDrop,
    parentDiff,
    relativeStartPoints,
    rowRef,
    stopReflowing,
    updateBottomRow,
    updateRelativeRows,
    widgetOccupiedSpace,
  } = useBlocksToBeDraggedOnCanvas({
    canExtend,
    noPad,
    snapColumnSpace,
    snapRows,
    snapRowSpace,
    widgetId,
  });
  const gridProps = {
    parentColumnSpace: snapColumnSpace,
    parentRowSpace: snapRowSpace,
    maxGridColumns: GridDefaults.DEFAULT_GRID_COLUMNS,
    paddingOffset: 0,
  };

  const reflow = useRef<ReflowInterface>();
  reflow.current = useReflow(
    widgetOccupiedSpace ? widgetOccupiedSpace.id : "",
    widgetId || "",
    gridProps,
  );

  const {
    setDraggingCanvas,
    setDraggingNewWidget,
    setDraggingState,
  } = useWidgetDragResize();
  const getCanvasToDrawTopOffset = (
    scrollParentTop: number,
    scrollParentTopHeight: number,
    canvasTop: number,
    canvasHeight: number,
  ) => {
    return scrollParentTop > canvasTop
      ? Math.min(
          scrollParentTop - canvasTop,
          canvasHeight - scrollParentTopHeight,
        )
      : 0;
  };

  const updateCanvasStyles = () => {
    const parentCanvas: Element | null = getNearestParentCanvas(
      canvasRef.current,
    );

    if (parentCanvas && canvasDrawRef.current && canvasRef.current) {
      const {
        height: scrollParentTopHeight,
      } = parentCanvas.getBoundingClientRect();
      const { width } = canvasRef.current.getBoundingClientRect();
      canvasDrawRef.current.style.width = width / canvasZoomLevel + "px";
      canvasDrawRef.current.style.position = canExtend ? "absolute" : "sticky";
      canvasDrawRef.current.style.left = "0px";
      canvasDrawRef.current.style.top = getCanvasTopOffset() + "px";
      canvasDrawRef.current.style.height =
        scrollParentTopHeight / canvasZoomLevel + "px";
    }
  };

  const getCanvasTopOffset = () => {
    const parentCanvas: Element | null = getNearestParentCanvas(
      canvasRef.current,
    );

    if (parentCanvas && canvasDrawRef.current && canvasRef.current) {
      if (canExtend) {
        return parentCanvas.scrollTop;
      } else {
        const {
          height: scrollParentTopHeight,
          top: scrollParentTop,
        } = parentCanvas.getBoundingClientRect();
        const {
          height: canvasHeight,
          top: canvasTop,
        } = canvasRef.current.getBoundingClientRect();
        return getCanvasToDrawTopOffset(
          scrollParentTop,
          scrollParentTopHeight,
          canvasTop,
          canvasHeight,
        );
      }
    }
    return 0;
  };

  const mouseAttributesRef = useRef<{
    prevEvent: any;
    currentEvent: any;
    prevSpeed: number;
    prevAcceleration: number;
    maxPositiveAcc: number;
    maxNegativeAcc: number;
    maxSpeed: number;
    lastMousePositionOutsideCanvas: {
      x: number;
      y: number;
    };
  }>({
    prevSpeed: 0,
    prevAcceleration: 0,
    maxPositiveAcc: 0,
    maxNegativeAcc: 0,
    maxSpeed: 0,
    prevEvent: null,
    currentEvent: null,
    lastMousePositionOutsideCanvas: {
      x: 0,
      y: 0,
    },
  });

  const canScroll = useCanvasDragToScroll(
    canvasRef,
    isCurrentDraggedCanvas,
    isDragging,
    snapRows,
    canExtend,
  );

  useEffect(() => {
    const speedCalculationInterval = setInterval(function() {
      const {
        currentEvent,
        maxNegativeAcc,
        maxPositiveAcc,
        maxSpeed,
        prevEvent,
        prevSpeed,
      } = mouseAttributesRef.current;
      if (prevEvent && currentEvent) {
        const movementX = Math.abs(currentEvent.screenX - prevEvent.screenX);
        const movementY = Math.abs(currentEvent.screenY - prevEvent.screenY);
        const movement = Math.sqrt(
          movementX * movementX + movementY * movementY,
        );

        const speed = 10 * movement; //current speed

        const acceleration = 10 * (speed - prevSpeed);
        mouseAttributesRef.current.prevAcceleration = acceleration;
        mouseAttributesRef.current.prevSpeed = speed;
        if (speed > maxSpeed) {
          mouseAttributesRef.current.maxSpeed = speed;
        }
        if (acceleration > 0 && acceleration > maxPositiveAcc) {
          mouseAttributesRef.current.maxPositiveAcc = acceleration;
        } else if (acceleration < 0 && acceleration < maxNegativeAcc) {
          mouseAttributesRef.current.maxNegativeAcc = acceleration;
        }
      }
      mouseAttributesRef.current.prevEvent = currentEvent;
    }, 100);
    const stopSpeedCalculation = () => {
      clearInterval(speedCalculationInterval);
    };
    const registerMouseMoveEvent = (e: any) => {
      mouseAttributesRef.current.currentEvent = e;
      mouseAttributesRef.current.lastMousePositionOutsideCanvas = {
        x: e.clientX,
        y: e.clientY,
      };
    };
    window.addEventListener("mousemove", registerMouseMoveEvent);
    return () => {
      stopSpeedCalculation();
      window.removeEventListener("mousemove", registerMouseMoveEvent);
    };
  }, []);

  useEffect(() => {
    if (
      canvasRef.current &&
      !isResizing &&
      isDragging &&
      blocksToDraw.length > 0
    ) {
      // doing throttling coz reflow moves are also throttled and resetCanvas can be called multiple times
      const throttledStopReflowing = throttle(stopReflowing, 50);
      const scrollParent: Element | null = getNearestParentCanvas(
        canvasRef.current,
      );
      let canvasIsDragging = false;
      let isUpdatingRows = false;
      let currentRectanglesToDraw: WidgetDraggingBlock[] = [];
      const scrollObj: any = {};

      let currentReflowParams: {
        canVerticalMove: boolean;
        canHorizontalMove: boolean;
        bottomMostRow: number;
        movementMap: ReflowedSpaceMap;
      } = {
        canVerticalMove: false,
        canHorizontalMove: false,
        bottomMostRow: 0,
        movementMap: {},
      };
      let lastMousePosition = {
        x: 0,
        y: 0,
      };
      let lastSnappedPosition = {
        leftColumn: 0,
        topRow: 0,
      };

      const resetCanvasState = () => {
        throttledStopReflowing();
        if (canvasDrawRef.current && canvasRef.current) {
          const canvasCtx: any = canvasDrawRef.current.getContext("2d");
          canvasCtx.clearRect(
            0,
            0,
            canvasDrawRef.current.width,
            canvasDrawRef.current.height,
          );
          canvasRef.current.style.zIndex = "";
          canvasIsDragging = false;
        }
      };
      if (isDragging) {
        const startPoints = defaultHandlePositions;
        const onMouseUp = () => {
          if (isDragging && canvasIsDragging) {
            const { movementMap: reflowingWidgets } = currentReflowParams;
            const reflowedPositionsUpdatesWidgets: OccupiedSpace[] = occSpaces
              .filter((each) => !!reflowingWidgets[each.id])
              .map((each) => {
                const reflowedWidget = reflowingWidgets[each.id];
                if (
                  reflowedWidget.X !== undefined &&
                  (Math.abs(reflowedWidget.X) || reflowedWidget.width)
                ) {
                  const movement = reflowedWidget.X / snapColumnSpace;
                  const newWidth = reflowedWidget.width
                    ? reflowedWidget.width / snapColumnSpace
                    : each.right - each.left;
                  each = {
                    ...each,
                    left: each.left + movement,
                    right: each.left + movement + newWidth,
                  };
                }
                if (
                  reflowedWidget.Y !== undefined &&
                  (Math.abs(reflowedWidget.Y) || reflowedWidget.height)
                ) {
                  const movement = reflowedWidget.Y / snapRowSpace;
                  const newHeight = reflowedWidget.height
                    ? reflowedWidget.height / snapRowSpace
                    : each.bottom - each.top;
                  each = {
                    ...each,
                    top: each.top + movement,
                    bottom: each.top + movement + newHeight,
                  };
                }
                return each;
              });

            onDrop(currentRectanglesToDraw, reflowedPositionsUpdatesWidgets);
          }
          startPoints.top = defaultHandlePositions.top;
          startPoints.left = defaultHandlePositions.left;
          resetCanvasState();

          if (isCurrentDraggedCanvas) {
            if (isNewWidget) {
              setDraggingNewWidget(false, undefined);
            } else {
              setDraggingState({
                isDragging: false,
              });
            }
            setDraggingCanvas();
          }
        };

        const onFirstMoveOnCanvas = (e: any, over = false) => {
          if (
            !isResizing &&
            isDragging &&
            !canvasIsDragging &&
            canvasRef.current
          ) {
            if (!isNewWidget) {
              startPoints.left =
                relativeStartPoints.left || defaultHandlePositions.left;
              startPoints.top =
                relativeStartPoints.top || defaultHandlePositions.top;
            }
            if (!isCurrentDraggedCanvas) {
              // we can just use canvasIsDragging but this is needed to render the relative DragLayerComponent
              setDraggingCanvas(widgetId);
            }
            canvasIsDragging = true;
            canvasRef.current.style.zIndex = "2";
            if (over) {
              lastMousePosition = {
                ...mouseAttributesRef.current.lastMousePositionOutsideCanvas,
              };
            } else {
              lastMousePosition = {
                x: e.clientX,
                y: e.clientY,
              };
            }

            onMouseMove(e, over);
          }
        };

        const canReflowForCurrentMouseMove = () => {
          const {
            maxNegativeAcc,
            maxPositiveAcc,
            maxSpeed,
            prevAcceleration,
            prevSpeed,
          } = mouseAttributesRef.current;
          const limit = Math.abs(
            prevAcceleration < 0 ? maxNegativeAcc : maxPositiveAcc,
          );
          const acceleration = Math.abs(prevAcceleration);
          return acceleration < limit / 5 || prevSpeed < maxSpeed / 5;
        };
        const getMouseMoveDirection = (event: any) => {
          if (lastMousePosition) {
            const deltaX = lastMousePosition.x - event.clientX,
              deltaY = lastMousePosition.y - event.clientY;
            lastMousePosition = {
              x: event.clientX,
              y: event.clientY,
            };
            if (
              deltaX === 0 &&
              ["TOP", "BOTTOM"].includes(currentDirection.current)
            ) {
              return currentDirection.current;
            }
            if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY > 0) {
              return ReflowDirection.TOP;
            } else if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY < 0) {
              return ReflowDirection.BOTTOM;
            }
            if (
              deltaY === 0 &&
              ["LEFT", "RIGHT"].includes(currentDirection.current)
            ) {
              return currentDirection.current;
            }
            if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX > 0) {
              return ReflowDirection.LEFT;
            } else if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX < 0) {
              return ReflowDirection.RIGHT;
            }
          }
          return currentDirection.current;
        };
        const triggerReflow = (e: any, firstMove: boolean) => {
          const canReflowBasedOnMouseSpeed = canReflowForCurrentMouseMove();
          const isReflowing = !isEmpty(currentReflowParams.movementMap);
          const canReflow =
            reflowEnabled &&
            currentRectanglesToDraw.length === 1 &&
            !currentRectanglesToDraw[0].detachFromLayout;
          const currentBlock = currentRectanglesToDraw[0];
          const [leftColumn, topRow] = getDropZoneOffsets(
            snapColumnSpace,
            snapRowSpace,
            {
              x: currentBlock.left,
              y: currentBlock.top,
            },
            {
              x: 0,
              y: 0,
            },
          );
          const needsReflow = !(
            lastSnappedPosition.leftColumn === leftColumn &&
            lastSnappedPosition.topRow === topRow
          );
          lastSnappedPosition = {
            leftColumn,
            topRow,
          };
          if (canReflow && reflow.current) {
            if (needsReflow) {
              const resizedPositions = {
                left: leftColumn,
                top: topRow,
                right: leftColumn + currentBlock.width / snapColumnSpace,
                bottom: topRow + currentBlock.height / snapRowSpace,
                id: currentBlock.widgetId,
              };
              const originalPositions = widgetOccupiedSpace
                ? { ...widgetOccupiedSpace }
                : {
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    id: currentBlock.widgetId,
                  };
              currentDirection.current = getMouseMoveDirection(e);
              const immediateExitContainer = lastDraggedCanvas.current;
              if (lastDraggedCanvas.current) {
                lastDraggedCanvas.current = undefined;
              }
              currentReflowParams = reflow.current(
                resizedPositions,
                originalPositions,
                currentDirection.current,
                false,
                !canReflowBasedOnMouseSpeed,
                firstMove,
                immediateExitContainer,
              );
            }

            if (isReflowing) {
              const block = currentRectanglesToDraw[0];
              const isNotInParentBoundaries = noCollision(
                { x: block.left, y: block.top },
                snapColumnSpace,
                snapRowSpace,
                { x: 0, y: 0 },
                block.columnWidth,
                block.rowHeight,
                block.widgetId,
                [],
                rowRef.current,
                GridDefaults.DEFAULT_GRID_COLUMNS,
                block.detachFromLayout,
              );
              const newRows = updateBottomRow(
                currentReflowParams.bottomMostRow,
                rowRef.current,
              );
              rowRef.current = newRows ? newRows : rowRef.current;
              currentRectanglesToDraw[0].isNotColliding =
                isNotInParentBoundaries &&
                currentReflowParams.canHorizontalMove &&
                currentReflowParams.canVerticalMove;
            }
          }
        };
        const onMouseMove = (e: any, firstMove = false) => {
          if (isDragging && canvasIsDragging && canvasRef.current) {
            const delta = {
              left: e.offsetX - startPoints.left - parentDiff.left,
              top: e.offsetY - startPoints.top - parentDiff.top,
            };

            const drawingBlocks = blocksToDraw.map((each) => ({
              ...each,
              left: each.left + delta.left,
              top: each.top + delta.top,
            }));
            const newRows = updateRelativeRows(drawingBlocks, rowRef.current);
            const rowDelta = newRows ? newRows - rowRef.current : 0;
            rowRef.current = newRows ? newRows : rowRef.current;
            currentRectanglesToDraw = drawingBlocks.map((each) => ({
              ...each,
              isNotColliding:
                !dropDisabled &&
                noCollision(
                  { x: each.left, y: each.top },
                  snapColumnSpace,
                  snapRowSpace,
                  { x: 0, y: 0 },
                  each.columnWidth,
                  each.rowHeight,
                  each.widgetId,
                  occSpaces,
                  rowRef.current,
                  GridDefaults.DEFAULT_GRID_COLUMNS,
                  each.detachFromLayout,
                ),
            }));
            if (rowDelta && canvasRef.current) {
              isUpdatingRows = true;
              canScroll.current = false;
              renderNewRows(delta);
            } else if (!isUpdatingRows) {
              triggerReflow(e, firstMove);
              renderBlocks();
            }
            scrollObj.lastMouseMoveEvent = {
              offsetX: e.offsetX,
              offsetY: e.offsetY,
            };
            scrollObj.lastScrollTop = scrollParent?.scrollTop;
            scrollObj.lastScrollHeight = scrollParent?.scrollHeight;
          } else {
            onFirstMoveOnCanvas(e);
          }
        };
        const renderNewRows = debounce((delta) => {
          isUpdatingRows = true;
          if (canvasRef.current && canvasDrawRef.current) {
            const canvasCtx: any = canvasDrawRef.current.getContext("2d");

            currentRectanglesToDraw = blocksToDraw.map((each) => {
              return {
                ...each,
                left: each.left + delta.left,
                top: each.top + delta.top,
                isNotColliding:
                  !dropDisabled &&
                  noCollision(
                    { x: each.left + delta.left, y: each.top + delta.top },
                    snapColumnSpace,
                    snapRowSpace,
                    { x: 0, y: 0 },
                    each.columnWidth,
                    each.rowHeight,
                    each.widgetId,
                    occSpaces,
                    rowRef.current,
                    GridDefaults.DEFAULT_GRID_COLUMNS,
                    each.detachFromLayout,
                  ),
              };
            });
            canvasCtx.save();
            canvasCtx.scale(scale, scale);
            canvasCtx.clearRect(
              0,
              0,
              canvasDrawRef.current.width,
              canvasDrawRef.current.height,
            );
            canvasCtx.restore();
            renderBlocks();
            canScroll.current = false;
            endRenderRows.cancel();
            endRenderRows();
          }
        });

        const endRenderRows = throttle(
          () => {
            canScroll.current = true;
          },
          50,
          {
            leading: false,
            trailing: true,
          },
        );

        const renderBlocks = () => {
          if (
            canvasRef.current &&
            isCurrentDraggedCanvas &&
            canvasIsDragging &&
            canvasDrawRef.current
          ) {
            const canvasCtx: any = canvasDrawRef.current.getContext("2d");
            canvasCtx.save();
            canvasCtx.clearRect(
              0,
              0,
              canvasDrawRef.current.width,
              canvasDrawRef.current.height,
            );
            isUpdatingRows = false;
            canvasCtx.transform(canvasZoomLevel, 0, 0, canvasZoomLevel, 0, 0);
            if (canvasIsDragging) {
              currentRectanglesToDraw.forEach((each) => {
                drawBlockOnCanvas(each);
              });
            }
            canvasCtx.restore();
          }
        };

        const drawBlockOnCanvas = (blockDimensions: WidgetDraggingBlock) => {
          if (
            canvasDrawRef.current &&
            canvasRef.current &&
            scrollParent &&
            isCurrentDraggedCanvas &&
            canvasIsDragging
          ) {
            const canvasCtx: any = canvasDrawRef.current.getContext("2d");
            const topOffset = getCanvasTopOffset();
            const snappedXY = getSnappedXY(
              snapColumnSpace,
              snapRowSpace,
              {
                x: blockDimensions.left,
                y: blockDimensions.top,
              },
              {
                x: 0,
                y: 0,
              },
            );

            canvasCtx.fillStyle = `${
              blockDimensions.isNotColliding ? "rgb(104,	113,	239, 0.6)" : "red"
            }`;
            canvasCtx.fillRect(
              blockDimensions.left + (noPad ? 0 : CONTAINER_GRID_PADDING),
              blockDimensions.top -
                topOffset +
                (noPad ? 0 : CONTAINER_GRID_PADDING),
              blockDimensions.width,
              blockDimensions.height,
            );
            canvasCtx.fillStyle = `${
              blockDimensions.isNotColliding ? "rgb(233, 250, 243, 0.6)" : "red"
            }`;
            const strokeWidth = 1;
            canvasCtx.setLineDash([3]);
            canvasCtx.strokeStyle = "rgb(104,	113,	239)";
            canvasCtx.strokeRect(
              snappedXY.X + strokeWidth + (noPad ? 0 : CONTAINER_GRID_PADDING),
              snappedXY.Y -
                topOffset +
                strokeWidth +
                (noPad ? 0 : CONTAINER_GRID_PADDING),
              blockDimensions.width - strokeWidth,
              blockDimensions.height - strokeWidth,
            );
          }
        };
        const onScroll = () => {
          const {
            lastMouseMoveEvent,
            lastScrollHeight,
            lastScrollTop,
          } = scrollObj;
          if (
            lastMouseMoveEvent &&
            Number.isInteger(lastScrollHeight) &&
            Number.isInteger(lastScrollTop) &&
            scrollParent &&
            canScroll.current
          ) {
            const delta =
              scrollParent?.scrollHeight +
              scrollParent?.scrollTop -
              (lastScrollHeight + lastScrollTop);
            onMouseMove({
              offsetX: lastMouseMoveEvent.offsetX,
              offsetY: lastMouseMoveEvent.offsetY + delta,
            });
          }
        };
        const captureMousePosition = (e: any) => {
          if (isDragging && !canvasIsDragging) {
            currentDirection.current = getMouseMoveDirection(e);
          }
        };
        const onMouseOver = (e: any) => onFirstMoveOnCanvas(e, true);
        const initializeListeners = () => {
          canvasRef.current?.addEventListener("mousemove", onMouseMove, false);
          canvasRef.current?.addEventListener("mouseup", onMouseUp, false);
          scrollParent?.addEventListener("scroll", updateCanvasStyles, false);
          scrollParent?.addEventListener("scroll", onScroll, false);

          canvasRef.current?.addEventListener("mouseover", onMouseOver, false);
          canvasRef.current?.addEventListener(
            "mouseout",
            resetCanvasState,
            false,
          );
          canvasRef.current?.addEventListener(
            "mouseleave",
            resetCanvasState,
            false,
          );
          document.body.addEventListener("mouseup", onMouseUp, false);
          window.addEventListener("mouseup", onMouseUp, false);
          window.addEventListener("mousemove", captureMousePosition);
        };
        const startDragging = () => {
          if (canvasRef.current && canvasDrawRef.current && scrollParent) {
            const { height } = scrollParent.getBoundingClientRect();
            const { width } = canvasRef.current.getBoundingClientRect();
            const canvasCtx: any = canvasDrawRef.current.getContext("2d");
            canvasDrawRef.current.width = width * scale;
            canvasDrawRef.current.height = height * scale;
            canvasCtx.scale(scale, scale);
            updateCanvasStyles();
            initializeListeners();
            if (
              (isChildOfCanvas || isNewWidgetInitialTargetCanvas) &&
              canvasRef.current
            ) {
              canvasRef.current.style.zIndex = "2";
            }
          }
        };
        startDragging();

        return () => {
          canvasRef.current?.removeEventListener("mousemove", onMouseMove);
          canvasRef.current?.removeEventListener("mouseup", onMouseUp);
          scrollParent?.removeEventListener("scroll", updateCanvasStyles);
          scrollParent?.removeEventListener("scroll", onScroll);
          canvasRef.current?.removeEventListener("mouseover", onMouseOver);
          canvasRef.current?.removeEventListener("mouseout", resetCanvasState);
          canvasRef.current?.removeEventListener(
            "mouseleave",
            resetCanvasState,
          );
          document.body.removeEventListener("mouseup", onMouseUp);
          window.removeEventListener("mouseup", onMouseUp);
          window.removeEventListener("mousemove", captureMousePosition);
        };
      } else {
        resetCanvasState();
      }
    }
  }, [
    isDragging,
    isResizing,
    blocksToDraw,
    snapRows,
    canExtend,
    reflowEnabled,
  ]);
  return {
    showCanvas: isDragging && !isResizing,
  };
};
