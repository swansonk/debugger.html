/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

// @flow
import {
  getHiddenBreakpoint,
  isEvaluatingExpression,
  getSelectedFrame,
  getSources,
  getLastCommand,
  wasStepping
} from "../../selectors";

import { mapFrames } from ".";
import { removeBreakpoint } from "../breakpoints";
import { evaluateExpressions } from "../expressions";
import { selectLocation } from "../sources";
import { loadSourceText } from "../sources/loadSourceText";
import { togglePaneCollapse } from "../ui";
import { command } from "./commands";
import { shouldStep } from "../../utils/pause";

import { updateFrameLocation } from "./mapFrames";

import { fetchScopes } from "./fetchScopes";

import type { Pause, Frame } from "../../types";
import type { ThunkArgs } from "../types";

async function getOriginalSourceForFrame(state, frame: Frame) {
  return getSources(state)[frame.location.sourceId];
}
/**
 * Debugger has just paused
 *
 * @param {object} pauseInfo
 * @memberof actions/pause
 * @static
 */
export function paused(pauseInfo: Pause) {
  return async function({ dispatch, getState, client, sourceMaps }: ThunkArgs) {
    const { thread, frames, why, loadedObjects } = pauseInfo;
    const topFrame = frames.length > 0 ? frames[0] : null;

    // NOTE: do not step when leaving a frame or paused at a debugger statement
    if (topFrame && !why.frameFinished && why.type == "resumeLimit") {
      const mappedFrame = await updateFrameLocation(topFrame, sourceMaps);
      const source = await getOriginalSourceForFrame(getState(), mappedFrame);

      // Ensure that the original file has loaded if there is one.
      await dispatch(loadSourceText(source));

      if (shouldStep(mappedFrame, getState(), sourceMaps)) {
        // When stepping past a location we shouldn't pause at according to the
        // source map, make sure we continue stepping in the same direction we
        // were going previously.
        const rewind = getLastCommand(getState(), thread) == "reverseStepOver";
        dispatch(command(rewind ? "reverseStepOver" : "stepOver"));
        return;
      }
    }

    dispatch({
      type: "PAUSED",
      thread,
      why,
      frames,
      selectedFrameId: topFrame ? topFrame.id : undefined,
      loadedObjects: loadedObjects || []
    });

    const hiddenBreakpoint = getHiddenBreakpoint(getState());
    if (hiddenBreakpoint) {
      dispatch(removeBreakpoint(hiddenBreakpoint));
    }

    await dispatch(mapFrames());

    const selectedFrame = getSelectedFrame(getState());
    if (selectedFrame) {
      await dispatch(selectLocation(selectedFrame.location));
    }

    if (!wasStepping(getState())) {
      dispatch(togglePaneCollapse("end", false));
    }

    await dispatch(fetchScopes());

    // Run after fetching scoping data so that it may make use of the sourcemap
    // expression mappings for local variables.
    const atException = why.type == "exception";
    if (!atException || !isEvaluatingExpression(getState())) {
      await dispatch(evaluateExpressions());
    }
  };
}
