raw_row = csvread("record_channel3.csv");
readings_as_column = transpose(raw_row);

sampling_frequency = 400;
time_period = 1/sampling_frequency;

dt = 0:time_period:2-time_period

[number_of_readings, no_] = size(readings_as_column);
nfft2 = 2^nextpow2(number_of_readings)
ff = fft(raw_row, nfft2)

% Final Fourier transform
fff = ff(1:nfft2/2)
plot(abs(fff))
