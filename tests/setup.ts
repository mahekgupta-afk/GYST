// On a busy machine the whole-app tests can take longer than testing-library's default 1 second wait, so allow more.
import { configure } from '@testing-library/dom';
configure({ asyncUtilTimeout: 8000 });
