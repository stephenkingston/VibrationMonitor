raw_row = csvread("Motor_no_loss.csv");
readings_as_column = transpose(raw_row);
disp(max(readings_as_column))
[number_of_readings, no_] = size(readings_as_column);

nyquist_sampling_frequency = 400;
sampling_frequency = 1666;
nyquist_time_period = 1/nyquist_sampling_frequency;

time_period = 1/sampling_frequency;
total_time = (number_of_readings - 1) * time_period;

dt = 0:time_period:2-nyquist_time_period;


nfft2 = 2^nextpow2(number_of_readings);
ff = fft(raw_row, nfft2);

%Plot time domain signal
tim_dom = [0:time_period:total_time];
plot(readings_as_column);

% Final Fourier transform
fff = ff(1:nfft2/2);
plot(abs(fff));
