/*
 * Copyright 2017-2018 Allegro.pl
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { time } from "d3";
import { List } from "immutable";
import { $, Expression, LimitExpression, ply } from "plywood";
import { Essence } from "../../../common/models/essence/essence";
import { ConcreteSeries } from "../../../common/models/series/concrete-series";
import { Sort } from "../../../common/models/sort/sort";
import { Split, toExpression as splitToExpression } from "../../../common/models/split/split";
import { TimeShiftEnv } from "../../../common/models/time-shift/time-shift-env";
import { Timekeeper } from "../../../common/models/timekeeper/timekeeper";
import { thread } from "../../../common/utils/functional/functional";
import { SPLIT } from "../../config/constants";

const $main = $("main");

function applySeries(series: List<ConcreteSeries>, timeShiftEnv: TimeShiftEnv, nestingLevel = 0) {
  return (query: Expression) => {
    return series.reduce((query, series) => {
      return query.performAction(series.plywoodExpression(nestingLevel, timeShiftEnv));
    }, query);
  };
}

function applyLimit(split: Split) {
  const limit = new LimitExpression({ value: 10000 });
  return (query: Expression) => query.performAction(limit);
}

function applySort(sort: Sort) {
  return (query: Expression) => query.performAction(sort.toExpression());
}

function applySplits(essence: Essence, timeShiftEnv: TimeShiftEnv): Expression {
  const { splits: { splits }, dataCube } = essence;
  const firstSplit = splits.first();

  const ss = splits.reduce((acc, split) => {
    const dimension = dataCube.getDimension(split.reference);
    const ex = splitToExpression(split, dimension, timeShiftEnv);
    return Object.assign({}, acc, { [dimension.name]: ex });
  }, {});

  return thread(
    $main.split(ss),
    applySort(firstSplit.sort),
    applyLimit(firstSplit),
    applySeries(essence.getConcreteSeries(), timeShiftEnv)
  );
}

export default function makeQuery(essence: Essence, timekeeper: Timekeeper): Expression {
  const { splits, dataCube } = essence;
  if (splits.length() > dataCube.getMaxSplits()) throw new Error(`Too many splits in query. DataCube "${dataCube.name}" supports only ${dataCube.getMaxSplits()} splits`);

  const hasComparison = essence.hasComparison();
  const mainFilter = essence.getEffectiveFilter(timekeeper, { combineWithPrevious: hasComparison });

  const timeShiftEnv: TimeShiftEnv = essence.getTimeShiftEnv(timekeeper);

  const mainExp: Expression = ply()
    .apply("main", $main.filter(mainFilter.toExpression(dataCube)));

  const queryWithMeasures = applySeries(essence.getConcreteSeries(), timeShiftEnv)(mainExp);

  return queryWithMeasures
    .apply(SPLIT, applySplits(essence, timeShiftEnv));
}
