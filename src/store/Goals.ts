import { Goal } from '../domain/models';
import { fmtKST } from '../utils';
import { AppState } from './AppState';

/** The investment goal and today's checklist. */
export class Goals {
  constructor(private state: AppState) {}

  setGoal(goal: Goal | undefined) {
    this.state.data.goal = goal;
    this.state.save();
  }

  /** Quest ids checked today; yesterday's checks don't carry over. */
  doneToday(now = Date.now()) {
    const q = this.state.data.quests;
    return q?.date === fmtKST(now) ? q.done : [];
  }

  toggleQuest(id: string, now = Date.now()) {
    const done = this.doneToday(now);
    this.state.data.quests = {
      date: fmtKST(now),
      done: done.includes(id) ? done.filter(x => x !== id) : [...done, id],
    };
    this.state.save();
  }
}
