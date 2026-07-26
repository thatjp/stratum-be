DO $$
DECLARE
  v_user_id        UUID;
  v_col_id         UUID;
  v_session_id     UUID;
  v_capture_id     UUID;
  v_conv_id        UUID;
  v_quiz_id        UUID;

  -- nugget ids
  n1 UUID; n2 UUID; n3 UUID; n4 UUID; n5 UUID;
  n6 UUID; n7 UUID; n8 UUID; n9 UUID; n10 UUID;
  n11 UUID; n12 UUID; n13 UUID; n14 UUID; n15 UUID;
  n16 UUID; n17 UUID; n18 UUID; n19 UUID; n20 UUID;
  n21 UUID; n22 UUID; n23 UUID; n24 UUID; n25 UUID;
  n26 UUID; n27 UUID; n28 UUID; n29 UUID; n30 UUID;

  -- artifact ids
  a1 UUID; a2 UUID; a3 UUID; a4 UUID; a5 UUID;
  a6 UUID; a7 UUID; a8 UUID; a9 UUID; a10 UUID;
  a11 UUID; a12 UUID; a13 UUID; a14 UUID; a15 UUID;
  a16 UUID; a17 UUID; a18 UUID; a19 UUID; a20 UUID;
  a21 UUID; a22 UUID; a23 UUID; a24 UUID; a25 UUID;
  a26 UUID; a27 UUID; a28 UUID; a29 UUID; a30 UUID;

BEGIN
  -- ── User ──────────────────────────────────────────────────────────────────
  SELECT id INTO v_user_id FROM users WHERE lower(email) = 'jpharris.contact@gmail.com';
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User jpharris.contact@gmail.com not found';
  END IF;

  -- ── Collection ────────────────────────────────────────────────────────────
  INSERT INTO collections (user_id, title, source_type, intent)
  VALUES (v_user_id, 'Thinking, Fast and Slow', 'book', 'study')
  RETURNING id INTO v_col_id;

  -- ── Session + Capture (photo) ─────────────────────────────────────────────
  INSERT INTO sessions (collection_id, user_id, input_mode, status, started_at, completed_at)
  VALUES (v_col_id, v_user_id, 'photo', 'complete', NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days')
  RETURNING id INTO v_session_id;

  INSERT INTO captures (session_id, user_id, kind, sequence_index, ocr_text, processing_status)
  VALUES (v_session_id, v_user_id, 'photo', 0,
    'System 1 operates automatically and quickly, with little or no effort and no sense of voluntary control. System 2 allocates attention to effortful mental activities.',
    'done')
  RETURNING id INTO v_capture_id;

  -- ── 30 Nuggets ────────────────────────────────────────────────────────────
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'System 1 thinking is fast, automatic, and effortless — it operates without conscious control.', NULL, 0.95, NOW() - INTERVAL '30 days') RETURNING id INTO n1;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'System 2 thinking is slow, deliberate, and effortful — it requires focused attention.', NULL, 0.95, NOW() - INTERVAL '29 days') RETURNING id INTO n2;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Cognitive ease describes the feeling of effortlessness when processing familiar or clear information.', NULL, 0.90, NOW() - INTERVAL '28 days') RETURNING id INTO n3;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'The anchoring effect: initial numbers or ideas disproportionately influence subsequent judgments.', NULL, 0.92, NOW() - INTERVAL '27 days') RETURNING id INTO n4;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Availability heuristic: people judge probability by how easily examples come to mind.', NULL, 0.88, NOW() - INTERVAL '26 days') RETURNING id INTO n5;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Representativeness heuristic: judgments about category membership are based on resemblance to a prototype.', NULL, 0.87, NOW() - INTERVAL '25 days') RETURNING id INTO n6;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Regression to the mean: extreme outcomes are typically followed by more moderate ones.', NULL, 0.85, NOW() - INTERVAL '24 days') RETURNING id INTO n7;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Loss aversion: losses loom larger than equivalent gains — roughly twice as powerful psychologically.', NULL, 0.93, NOW() - INTERVAL '23 days') RETURNING id INTO n8;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'The planning fallacy: people underestimate time, costs, and risks of future actions while overestimating benefits.', NULL, 0.91, NOW() - INTERVAL '22 days') RETURNING id INTO n9;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Prospect theory: people evaluate outcomes relative to a reference point, not in absolute terms.', NULL, 0.89, NOW() - INTERVAL '21 days') RETURNING id INTO n10;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'The halo effect: one positive trait causes us to assume other positive traits in a person or thing.', NULL, 0.90, NOW() - INTERVAL '20 days') RETURNING id INTO n11;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Priming: exposure to one stimulus influences the response to a later stimulus without conscious awareness.', NULL, 0.86, NOW() - INTERVAL '19 days') RETURNING id INTO n12;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Overconfidence bias: people systematically overestimate the accuracy of their own knowledge and predictions.', NULL, 0.88, NOW() - INTERVAL '18 days') RETURNING id INTO n13;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'The endowment effect: people value things more once they own them than before they owned them.', NULL, 0.84, NOW() - INTERVAL '17 days') RETURNING id INTO n14;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Framing effect: the way information is presented changes how people evaluate and decide upon it.', NULL, 0.91, NOW() - INTERVAL '16 days') RETURNING id INTO n15;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Sunk-cost fallacy: people irrationally continue investments based on past costs rather than future value.', NULL, 0.87, NOW() - INTERVAL '15 days') RETURNING id INTO n16;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'WYSIATI (What You See Is All There Is): System 1 constructs coherent stories from available information, ignoring gaps.', NULL, 0.92, NOW() - INTERVAL '14 days') RETURNING id INTO n17;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Affect heuristic: people let emotional responses guide judgments of benefit and risk.', NULL, 0.83, NOW() - INTERVAL '13 days') RETURNING id INTO n18;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Denominator neglect: people focus on the numerator (number of events) rather than the base rate.', NULL, 0.80, NOW() - INTERVAL '12 days') RETURNING id INTO n19;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'The focusing illusion: nothing in life is as important as you think it is when you are thinking about it.', NULL, 0.94, NOW() - INTERVAL '11 days') RETURNING id INTO n20;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Hindsight bias: after an event, people believe they predicted it all along.', NULL, 0.89, NOW() - INTERVAL '10 days') RETURNING id INTO n21;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Expert intuition is reliable only when built through prolonged practice in a high-validity environment.', NULL, 0.86, NOW() - INTERVAL '9 days') RETURNING id INTO n22;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Cognitive load: System 2 has limited capacity; multitasking degrades quality of deliberate thought.', NULL, 0.88, NOW() - INTERVAL '8 days') RETURNING id INTO n23;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'The peak-end rule: people judge an experience by its most intense point and its ending, not its average.', NULL, 0.90, NOW() - INTERVAL '7 days') RETURNING id INTO n24;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Duration neglect: the length of an experience has little influence on the remembered evaluation of it.', NULL, 0.82, NOW() - INTERVAL '6 days') RETURNING id INTO n25;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'The experiencing self lives in the present; the remembering self keeps score and governs choices.', NULL, 0.91, NOW() - INTERVAL '5 days') RETURNING id INTO n26;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Narrative fallacy: we construct simple causal stories to explain complex events, reducing perceived randomness.', NULL, 0.85, NOW() - INTERVAL '4 days') RETURNING id INTO n27;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'The illusion of validity: confidence in predictions is not reduced by poor accuracy track records.', NULL, 0.78, NOW() - INTERVAL '3 days') RETURNING id INTO n28;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Optimism bias: most people believe they are above average and underestimate personal risks.', NULL, 0.87, NOW() - INTERVAL '2 days') RETURNING id INTO n29;
  INSERT INTO nuggets (capture_id, collection_id, user_id, content, source_text, confidence, created_at)
  VALUES (v_capture_id, v_col_id, v_user_id, 'Dual-process theory underpins behavioural economics — rational models ignore the role of System 1.', NULL, 0.93, NOW() - INTERVAL '1 day') RETURNING id INTO n30;

  -- ── Artifacts (flashcards, quiz questions, summary bullets, vocab cards) ──
  -- Accepted with varied interval_days to simulate different SRS stages

  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n1, v_user_id, 'flashcard', 'What is System 1 thinking?', 'Fast, automatic, effortless — operates without conscious control.', 'accepted', 2.8, 21, NOW() + INTERVAL '21 days') RETURNING id INTO a1;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n2, v_user_id, 'flashcard', 'What is System 2 thinking?', 'Slow, deliberate, effortful — requires focused attention.', 'accepted', 2.6, 14, NOW() + INTERVAL '14 days') RETURNING id INTO a2;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n3, v_user_id, 'flashcard', 'Define cognitive ease.', 'The feeling of effortlessness when processing familiar or clear information.', 'accepted', 2.5, 10, NOW() + INTERVAL '10 days') RETURNING id INTO a3;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n4, v_user_id, 'quiz_question', 'How does anchoring affect judgment?', 'Initial numbers or ideas disproportionately influence subsequent judgments.', 'accepted', 2.7, 18, NOW() + INTERVAL '18 days') RETURNING id INTO a4;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n5, v_user_id, 'quiz_question', 'What is the availability heuristic?', 'Judging probability by how easily examples come to mind.', 'accepted', 2.4, 7, NOW() + INTERVAL '7 days') RETURNING id INTO a5;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n6, v_user_id, 'flashcard', 'Explain the representativeness heuristic.', 'Judging category membership based on resemblance to a prototype.', 'accepted', 2.3, 5, NOW() + INTERVAL '5 days') RETURNING id INTO a6;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n7, v_user_id, 'flashcard', 'What is regression to the mean?', 'Extreme outcomes are typically followed by more moderate ones.', 'accepted', 2.5, 12, NOW() + INTERVAL '12 days') RETURNING id INTO a7;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n8, v_user_id, 'quiz_question', 'How powerful is loss aversion relative to gains?', 'Losses loom roughly twice as large as equivalent gains.', 'accepted', 2.9, 21, NOW() + INTERVAL '21 days') RETURNING id INTO a8;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n9, v_user_id, 'summary_bullet', 'Planning fallacy', 'People underestimate time/cost/risk and overestimate benefits of future actions.', 'accepted', 2.4, 6, NOW() + INTERVAL '6 days') RETURNING id INTO a9;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n10, v_user_id, 'flashcard', 'What is prospect theory?', 'People evaluate outcomes relative to a reference point, not absolute values.', 'accepted', 2.6, 9, NOW() + INTERVAL '9 days') RETURNING id INTO a10;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n11, v_user_id, 'flashcard', 'Define the halo effect.', 'One positive trait causes us to assume other positive traits.', 'accepted', 2.5, 8, NOW() + INTERVAL '8 days') RETURNING id INTO a11;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n12, v_user_id, 'quiz_question', 'What is priming?', 'Exposure to one stimulus unconsciously influences response to a later stimulus.', 'accepted', 2.3, 4, NOW() + INTERVAL '4 days') RETURNING id INTO a12;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n13, v_user_id, 'summary_bullet', 'Overconfidence bias', 'People overestimate accuracy of their knowledge and predictions.', 'accepted', 2.2, 3, NOW() + INTERVAL '3 days') RETURNING id INTO a13;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n14, v_user_id, 'flashcard', 'What is the endowment effect?', 'People value things more once they own them.', 'accepted', 2.4, 6, NOW() + INTERVAL '6 days') RETURNING id INTO a14;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n15, v_user_id, 'quiz_question', 'How does framing affect decisions?', 'The way information is presented changes how people evaluate and decide.', 'accepted', 2.7, 15, NOW() + INTERVAL '15 days') RETURNING id INTO a15;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n16, v_user_id, 'summary_bullet', 'Sunk-cost fallacy', 'Irrational continuation of investments based on past costs, not future value.', 'accepted', 2.3, 5, NOW() + INTERVAL '5 days') RETURNING id INTO a16;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n17, v_user_id, 'flashcard', 'What does WYSIATI stand for and mean?', 'What You See Is All There Is — System 1 builds stories from available data, ignoring gaps.', 'accepted', 2.8, 19, NOW() + INTERVAL '19 days') RETURNING id INTO a17;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n18, v_user_id, 'flashcard', 'What is the affect heuristic?', 'Emotional responses guide judgments of benefit and risk.', 'accepted', 2.2, 2, NOW() + INTERVAL '2 days') RETURNING id INTO a18;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n19, v_user_id, 'quiz_question', 'What is denominator neglect?', 'Focusing on the count of events rather than the base rate.', 'accepted', 2.1, 1, NOW() + INTERVAL '1 day') RETURNING id INTO a19;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n20, v_user_id, 'vocab_card', 'Focusing illusion', 'Nothing in life is as important as you think it is when you are thinking about it.', 'accepted', 2.9, 21, NOW() + INTERVAL '21 days') RETURNING id INTO a20;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n21, v_user_id, 'flashcard', 'Define hindsight bias.', 'After an event, believing you predicted it all along.', 'accepted', 2.5, 11, NOW() + INTERVAL '11 days') RETURNING id INTO a21;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n22, v_user_id, 'quiz_question', 'When is expert intuition reliable?', 'Only when built through prolonged practice in a high-validity environment.', 'accepted', 2.6, 13, NOW() + INTERVAL '13 days') RETURNING id INTO a22;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n23, v_user_id, 'summary_bullet', 'Cognitive load', 'System 2 has limited capacity; multitasking degrades deliberate thought.', 'accepted', 2.4, 7, NOW() + INTERVAL '7 days') RETURNING id INTO a23;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n24, v_user_id, 'flashcard', 'What is the peak-end rule?', 'Experiences are judged by their most intense point and ending, not their average.', 'accepted', 2.7, 16, NOW() + INTERVAL '16 days') RETURNING id INTO a24;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n25, v_user_id, 'vocab_card', 'Duration neglect', 'The length of an experience has little influence on its remembered evaluation.', 'accepted', 2.3, 4, NOW() + INTERVAL '4 days') RETURNING id INTO a25;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n26, v_user_id, 'flashcard', 'Distinguish the experiencing self from the remembering self.', 'Experiencing self lives in the present; remembering self keeps score and governs choices.', 'accepted', 2.8, 20, NOW() + INTERVAL '20 days') RETURNING id INTO a26;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days, due_at)
  VALUES (n27, v_user_id, 'summary_bullet', 'Narrative fallacy', 'We construct simple causal stories to explain complex events, reducing perceived randomness.', 'accepted', 2.4, 8, NOW() + INTERVAL '8 days') RETURNING id INTO a27;
  -- n28, n29, n30 get no artifacts (newly extracted) → proficiency = 0.05
  -- but add pending artifacts so they appear less naked
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days)
  VALUES (n28, v_user_id, 'flashcard', 'What is the illusion of validity?', 'Confidence in predictions is not reduced by poor accuracy track records.', 'pending_review', 2.5, 1) RETURNING id INTO a28;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days)
  VALUES (n29, v_user_id, 'quiz_question', 'Describe optimism bias.', 'Most people believe they are above average and underestimate personal risks.', 'pending_review', 2.5, 1) RETURNING id INTO a29;
  INSERT INTO artifacts (nugget_id, user_id, kind, front, back, status, ease_factor, interval_days)
  VALUES (n30, v_user_id, 'summary_bullet', 'Dual-process & behavioural economics', 'Rational models ignore System 1; dual-process theory underpins behavioural economics.', 'pending_review', 2.5, 1) RETURNING id INTO a30;

  -- ── Recall attempts — varied history to create real proficiency spread ────

  -- n1 / a1: very well retained (8 correct, 1 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a1, v_user_id, 'correct',   1200, NOW() - INTERVAL '28 days'),
  (a1, v_user_id, 'incorrect', 3400, NOW() - INTERVAL '25 days'),
  (a1, v_user_id, 'correct',   1100, NOW() - INTERVAL '21 days'),
  (a1, v_user_id, 'correct',    980, NOW() - INTERVAL '17 days'),
  (a1, v_user_id, 'correct',    850, NOW() - INTERVAL '13 days'),
  (a1, v_user_id, 'correct',    790, NOW() - INTERVAL '9 days'),
  (a1, v_user_id, 'correct',    720, NOW() - INTERVAL '6 days'),
  (a1, v_user_id, 'correct',    680, NOW() - INTERVAL '3 days'),
  (a1, v_user_id, 'correct',    650, NOW() - INTERVAL '1 day');

  -- n2 / a2: well retained (6 correct, 1 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a2, v_user_id, 'correct',   1400, NOW() - INTERVAL '27 days'),
  (a2, v_user_id, 'correct',   1200, NOW() - INTERVAL '22 days'),
  (a2, v_user_id, 'incorrect', 2800, NOW() - INTERVAL '16 days'),
  (a2, v_user_id, 'correct',   1050, NOW() - INTERVAL '11 days'),
  (a2, v_user_id, 'correct',    920, NOW() - INTERVAL '7 days'),
  (a2, v_user_id, 'correct',    840, NOW() - INTERVAL '3 days'),
  (a2, v_user_id, 'correct',    800, NOW() - INTERVAL '1 day');

  -- n3 / a3: moderate (4 correct, 2 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a3, v_user_id, 'incorrect', 4200, NOW() - INTERVAL '26 days'),
  (a3, v_user_id, 'correct',   1800, NOW() - INTERVAL '20 days'),
  (a3, v_user_id, 'correct',   1500, NOW() - INTERVAL '14 days'),
  (a3, v_user_id, 'incorrect', 3100, NOW() - INTERVAL '9 days'),
  (a3, v_user_id, 'correct',   1300, NOW() - INTERVAL '5 days'),
  (a3, v_user_id, 'correct',   1100, NOW() - INTERVAL '2 days');

  -- n4 / a4: good (5 correct, 1 skipped)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a4, v_user_id, 'correct',   1300, NOW() - INTERVAL '25 days'),
  (a4, v_user_id, 'skipped',   NULL, NOW() - INTERVAL '20 days'),
  (a4, v_user_id, 'correct',   1150, NOW() - INTERVAL '15 days'),
  (a4, v_user_id, 'correct',   1000, NOW() - INTERVAL '10 days'),
  (a4, v_user_id, 'correct',    880, NOW() - INTERVAL '6 days'),
  (a4, v_user_id, 'correct',    820, NOW() - INTERVAL '2 days');

  -- n5 / a5: struggling (2 correct, 3 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a5, v_user_id, 'incorrect', 5000, NOW() - INTERVAL '24 days'),
  (a5, v_user_id, 'incorrect', 4500, NOW() - INTERVAL '18 days'),
  (a5, v_user_id, 'correct',   2200, NOW() - INTERVAL '12 days'),
  (a5, v_user_id, 'incorrect', 3800, NOW() - INTERVAL '7 days'),
  (a5, v_user_id, 'correct',   2000, NOW() - INTERVAL '3 days');

  -- n6 / a6: weak (1 correct, 3 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a6, v_user_id, 'incorrect', 5500, NOW() - INTERVAL '23 days'),
  (a6, v_user_id, 'incorrect', 4800, NOW() - INTERVAL '16 days'),
  (a6, v_user_id, 'correct',   2400, NOW() - INTERVAL '10 days'),
  (a6, v_user_id, 'incorrect', 4200, NOW() - INTERVAL '4 days');

  -- n7 / a7: good (4 correct, 1 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a7, v_user_id, 'correct',   1500, NOW() - INTERVAL '22 days'),
  (a7, v_user_id, 'incorrect', 3200, NOW() - INTERVAL '16 days'),
  (a7, v_user_id, 'correct',   1300, NOW() - INTERVAL '11 days'),
  (a7, v_user_id, 'correct',   1100, NOW() - INTERVAL '6 days'),
  (a7, v_user_id, 'correct',    950, NOW() - INTERVAL '2 days');

  -- n8 / a8: excellent (7 correct, 0 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a8, v_user_id, 'correct',   1100, NOW() - INTERVAL '21 days'),
  (a8, v_user_id, 'correct',    980, NOW() - INTERVAL '17 days'),
  (a8, v_user_id, 'correct',    890, NOW() - INTERVAL '13 days'),
  (a8, v_user_id, 'correct',    800, NOW() - INTERVAL '9 days'),
  (a8, v_user_id, 'correct',    740, NOW() - INTERVAL '6 days'),
  (a8, v_user_id, 'correct',    700, NOW() - INTERVAL '3 days'),
  (a8, v_user_id, 'correct',    660, NOW() - INTERVAL '1 day');

  -- n9 / a9: moderate (3 correct, 2 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a9, v_user_id, 'incorrect', 4100, NOW() - INTERVAL '20 days'),
  (a9, v_user_id, 'correct',   1900, NOW() - INTERVAL '14 days'),
  (a9, v_user_id, 'incorrect', 3500, NOW() - INTERVAL '9 days'),
  (a9, v_user_id, 'correct',   1600, NOW() - INTERVAL '5 days'),
  (a9, v_user_id, 'correct',   1400, NOW() - INTERVAL '2 days');

  -- n10 / a10: moderate-good (4 correct, 1 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a10, v_user_id, 'correct',   1600, NOW() - INTERVAL '19 days'),
  (a10, v_user_id, 'incorrect', 3300, NOW() - INTERVAL '13 days'),
  (a10, v_user_id, 'correct',   1400, NOW() - INTERVAL '8 days'),
  (a10, v_user_id, 'correct',   1200, NOW() - INTERVAL '4 days'),
  (a10, v_user_id, 'correct',   1050, NOW() - INTERVAL '1 day');

  -- n11 / a11: moderate (3 correct, 2 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a11, v_user_id, 'incorrect', 4400, NOW() - INTERVAL '18 days'),
  (a11, v_user_id, 'correct',   2000, NOW() - INTERVAL '12 days'),
  (a11, v_user_id, 'incorrect', 3600, NOW() - INTERVAL '7 days'),
  (a11, v_user_id, 'correct',   1700, NOW() - INTERVAL '3 days'),
  (a11, v_user_id, 'correct',   1500, NOW() - INTERVAL '1 day');

  -- n12 / a12: weak (2 correct, 3 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a12, v_user_id, 'incorrect', 5200, NOW() - INTERVAL '17 days'),
  (a12, v_user_id, 'incorrect', 4700, NOW() - INTERVAL '11 days'),
  (a12, v_user_id, 'correct',   2300, NOW() - INTERVAL '6 days'),
  (a12, v_user_id, 'incorrect', 4000, NOW() - INTERVAL '3 days'),
  (a12, v_user_id, 'correct',   2100, NOW() - INTERVAL '1 day');

  -- n13 / a13: very weak (1 correct, 4 incorrect)
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a13, v_user_id, 'incorrect', 6000, NOW() - INTERVAL '16 days'),
  (a13, v_user_id, 'incorrect', 5500, NOW() - INTERVAL '10 days'),
  (a13, v_user_id, 'incorrect', 5000, NOW() - INTERVAL '6 days'),
  (a13, v_user_id, 'correct',   2800, NOW() - INTERVAL '3 days'),
  (a13, v_user_id, 'incorrect', 4500, NOW() - INTERVAL '1 day');

  -- n14-n27: shorter histories for variety
  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a14, v_user_id, 'correct',   1400, NOW() - INTERVAL '15 days'),
  (a14, v_user_id, 'correct',   1200, NOW() - INTERVAL '8 days'),
  (a14, v_user_id, 'incorrect', 3000, NOW() - INTERVAL '3 days');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a15, v_user_id, 'correct',   1100, NOW() - INTERVAL '14 days'),
  (a15, v_user_id, 'correct',    980, NOW() - INTERVAL '8 days'),
  (a15, v_user_id, 'correct',    850, NOW() - INTERVAL '3 days');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a16, v_user_id, 'incorrect', 4800, NOW() - INTERVAL '13 days'),
  (a16, v_user_id, 'correct',   2100, NOW() - INTERVAL '7 days'),
  (a16, v_user_id, 'incorrect', 3900, NOW() - INTERVAL '2 days');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a17, v_user_id, 'correct',   1300, NOW() - INTERVAL '12 days'),
  (a17, v_user_id, 'correct',   1100, NOW() - INTERVAL '7 days'),
  (a17, v_user_id, 'correct',    950, NOW() - INTERVAL '2 days');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a18, v_user_id, 'incorrect', 5100, NOW() - INTERVAL '11 days'),
  (a18, v_user_id, 'incorrect', 4600, NOW() - INTERVAL '6 days'),
  (a18, v_user_id, 'correct',   2500, NOW() - INTERVAL '2 days');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a19, v_user_id, 'incorrect', 5800, NOW() - INTERVAL '10 days'),
  (a19, v_user_id, 'incorrect', 5200, NOW() - INTERVAL '5 days'),
  (a19, v_user_id, 'incorrect', 4800, NOW() - INTERVAL '1 day');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a20, v_user_id, 'correct',   1000, NOW() - INTERVAL '9 days'),
  (a20, v_user_id, 'correct',    880, NOW() - INTERVAL '5 days'),
  (a20, v_user_id, 'correct',    800, NOW() - INTERVAL '1 day');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a21, v_user_id, 'correct',   1500, NOW() - INTERVAL '8 days'),
  (a21, v_user_id, 'incorrect', 3200, NOW() - INTERVAL '4 days'),
  (a21, v_user_id, 'correct',   1300, NOW() - INTERVAL '1 day');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a22, v_user_id, 'correct',   1200, NOW() - INTERVAL '7 days'),
  (a22, v_user_id, 'correct',   1050, NOW() - INTERVAL '3 days'),
  (a22, v_user_id, 'correct',    920, NOW() - INTERVAL '1 day');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a23, v_user_id, 'incorrect', 4300, NOW() - INTERVAL '6 days'),
  (a23, v_user_id, 'correct',   2000, NOW() - INTERVAL '3 days'),
  (a23, v_user_id, 'correct',   1700, NOW() - INTERVAL '1 day');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a24, v_user_id, 'correct',   1100, NOW() - INTERVAL '5 days'),
  (a24, v_user_id, 'correct',    980, NOW() - INTERVAL '2 days');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a25, v_user_id, 'incorrect', 4900, NOW() - INTERVAL '4 days'),
  (a25, v_user_id, 'correct',   2200, NOW() - INTERVAL '1 day');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a26, v_user_id, 'correct',   1400, NOW() - INTERVAL '3 days'),
  (a26, v_user_id, 'correct',   1200, NOW() - INTERVAL '1 day');

  INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms, attempted_at) VALUES
  (a27, v_user_id, 'correct',   1600, NOW() - INTERVAL '2 days'),
  (a27, v_user_id, 'correct',   1350, NOW() - INTERVAL '1 day');

  -- n28/a28, n29/a29, n30/a30 are pending — no recall attempts, proficiency ≈ 0.05

  -- ── Conversations linked to this collection ───────────────────────────────
  INSERT INTO conversations (user_id, collection_id, scope, socratic_enabled, title, synopsis, message_count, created_at, updated_at)
  VALUES (v_user_id, v_col_id, 'collection', true, 'System 1 vs System 2 deep dive',
    'Explored the distinction between fast intuitive thinking and slow deliberate reasoning, with examples from the book.',
    12, NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days')
  RETURNING id INTO v_conv_id;

  INSERT INTO messages (conversation_id, role, content, created_at) VALUES
  (v_conv_id, 'user', 'Can you explain the difference between System 1 and System 2 thinking?', NOW() - INTERVAL '20 days'),
  (v_conv_id, 'assistant', 'System 1 operates automatically and quickly, with little or no effort and no sense of voluntary control. It handles things like reading emotions on faces or completing the phrase "bread and...". System 2, on the other hand, allocates attention to effortful mental activities like solving 17 × 24 or filling out a tax form. The key insight is that System 2 often endorses System 1''s impressions without realising they''re based on heuristics.', NOW() - INTERVAL '20 days');

  INSERT INTO conversations (user_id, collection_id, scope, socratic_enabled, title, synopsis, message_count, created_at, updated_at)
  VALUES (v_user_id, v_col_id, 'collection', false, 'Loss aversion and prospect theory',
    'Discussed how people weight losses more heavily than gains, and how reference points shape perceived value.',
    8, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days');

  INSERT INTO conversations (user_id, collection_id, scope, socratic_enabled, title, synopsis, message_count, created_at, updated_at)
  VALUES (v_user_id, v_col_id, 'collection', true, 'Heuristics and their pitfalls',
    'Explored availability, representativeness, and anchoring heuristics and when they lead to systematic errors.',
    16, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days');

  -- ── Quiz sessions ─────────────────────────────────────────────────────────
  INSERT INTO quiz_sessions (user_id, collection_id, mode, question_count, score, max_score, performance_overview, created_at, completed_at)
  VALUES (v_user_id, v_col_id, 'final', 10, 7, 10,
    'Good overall recall. Struggled with availability heuristic and denominator neglect. Strong on loss aversion and System 1/2 distinction.',
    NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days')
  RETURNING id INTO v_quiz_id;

  INSERT INTO quiz_questions (quiz_session_id, nugget_id, artifact_id, question, expected_answer, user_answer, is_correct, feedback) VALUES
  (v_quiz_id, n1, a1, 'What is System 1 thinking?', 'Fast, automatic, effortless.', 'Fast and automatic thinking that doesn''t require effort.', true, 'Correct — System 1 is automatic and effortless.'),
  (v_quiz_id, n5, a5, 'What is the availability heuristic?', 'Judging probability by how easily examples come to mind.', 'When something is easy to think of we assume it''s common.', true, 'Good — you captured the core idea.'),
  (v_quiz_id, n8, a8, 'How powerful is loss aversion relative to gains?', 'Losses loom roughly twice as large.', 'Losses hurt about twice as much as equivalent gains feel good.', true, 'Excellent.'),
  (v_quiz_id, n19, a19, 'What is denominator neglect?', 'Focusing on count not base rate.', 'I''m not sure.', false, 'Denominator neglect is when people focus on the numerator — the raw count — rather than the base rate.'),
  (v_quiz_id, n13, a13, 'What is overconfidence bias?', 'Overestimating accuracy of knowledge.', 'People think they know more than they do.', true, 'Correct.');

  INSERT INTO quiz_sessions (user_id, collection_id, mode, question_count, score, max_score, performance_overview, created_at, completed_at)
  VALUES (v_user_id, v_col_id, 'final', 10, 9, 10,
    'Excellent session. Near-perfect recall on most concepts. Minor confusion on narrative fallacy vs hindsight bias.',
    NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days');

  RAISE NOTICE 'Seed complete. Collection id: %', v_col_id;
END $$;
